"""Write a plan.json as an AutoCAD-style DXF, for testing the DXF reader
(T-016) against known ground truth.

Conventions followed (common in architectural CAD): millimetres; walls as
closed polylines per wall piece on A-WALL, capped across openings; doors
as a DOOR block (leaf and swing arc) on A-DOOR; windows as a WINDOW block
(three glazing lines) on A-GLAZ; room names and areas as TEXT on
A-AREA-IDEN; furniture on A-FURN; toilet floor hatch on A-FLOR-PATT; an
overall dimension on A-ANNO-DIMS.

    style "poly":    as above
    style "lines":   walls exploded into LINE entities, shuffled
    style "hatched": "poly" plus an ANSI31 wall hatch on A-WALL-PATT
    style "gappy":   exploratory; "lines" with each end pulled back 0-5 mm (ends miss)
    style "overshoot": exploratory; "lines" with each end pushed out 0-20 mm
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import ezdxf
import numpy as np

from plan3d import plan2d
from plan3d.model import load_plan

MM = 1000.0


def _mm(p) -> tuple[float, float]:
    return (round(float(p[0]) * MM, 3), round(float(p[1]) * MM, 3))


def write(plan_path: str | Path, out_dxf: str | Path, style: str = "poly", seed: int = 7) -> dict:
    plan, errors = load_plan(plan_path)
    assert plan is not None, errors
    lay = plan2d.build_layout(plan, sorted(plan.levels)[0])
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 4                          # millimetres
    for name, colour in (("A-WALL", 7), ("A-WALL-PATT", 8), ("A-DOOR", 2), ("A-GLAZ", 4),
                         ("A-AREA-IDEN", 3), ("A-FURN", 9), ("A-FLOR-PATT", 8), ("A-ANNO-DIMS", 1)):
        doc.layers.add(name, color=colour)
    door = doc.blocks.new("DOOR")                        # unit door: closed along +X, open leaf along +Y
    door.add_line((0, 0), (0, 1), dxfattribs={"layer": "0"})
    door.add_arc((0, 0), 1, 0, 90, dxfattribs={"layer": "0"})
    window = doc.blocks.new("WINDOW")                    # unit window: length along +X, wall depth along +Y
    for y in (-0.45, 0.0, 0.45):
        window.add_line((0, y), (1, y), dxfattribs={"layer": "0"})
    for x in (0, 1):
        window.add_line((x, -0.5), (x, 0.5), dxfattribs={"layer": "0"})
    msp = doc.modelspace()

    walls = lay.footprint
    for og in lay.openings.values():
        walls = walls.difference(og.rect)
    rings = [r for g in getattr(walls, "geoms", [walls]) for r in [g.exterior, *g.interiors]]
    if style in ("lines", "gappy", "overshoot"):
        rnd = random.Random(seed)
        segs = [(np.asarray(a), np.asarray(b)) for r in rings for a, b in zip(list(r.coords), list(r.coords)[1:])]
        rnd.shuffle(segs)
        for a, b in segs:
            d = (b - a) / np.linalg.norm(b - a)
            lo, hi = {"lines": (0, 0), "gappy": (-0.005, 0), "overshoot": (0, 0.02)}[style]
            a, b = a - d * rnd.uniform(lo, hi), b + d * rnd.uniform(lo, hi)
            msp.add_line(_mm(a), _mm(b), dxfattribs={"layer": "A-WALL"})
    else:
        for r in rings:
            msp.add_lwpolyline([_mm(p) for p in list(r.coords)[:-1]], close=True, dxfattribs={"layer": "A-WALL"})
    if style == "hatched":
        hatch = msp.add_hatch(dxfattribs={"layer": "A-WALL-PATT"})
        hatch.set_pattern_fill("ANSI31", scale=10.0)
        for g in getattr(walls, "geoms", [walls]):
            hatch.paths.add_polyline_path([_mm(p) for p in list(g.exterior.coords)[:-1]], is_closed=True,
                                          flags=ezdxf.const.BOUNDARY_PATH_EXTERNAL)
            for hole in g.interiors:
                hatch.paths.add_polyline_path([_mm(p) for p in list(hole.coords)[:-1]], is_closed=True)

    for og in lay.openings.values():
        wg = lay.walls[og.wall_id]
        width = (og.b - og.a) * MM
        if og.kind == "window":
            ang = math.degrees(math.atan2(wg.direction[1], wg.direction[0]))
            start = wg.point_at(og.a)
            msp.add_blockref("WINDOW", _mm(start), dxfattribs={
                "layer": "A-GLAZ", "xscale": width, "yscale": wg.thickness * MM, "rotation": ang})
        elif og.kind == "door":
            hinge, u = plan2d.door_hinge(lay, og)
            n = wg.normal * plan2d.door_side(og)
            ang = math.degrees(math.atan2(u[1], u[0]))
            flip = 1.0 if u[0] * n[1] - u[1] * n[0] > 0 else -1.0     # mirror when the leaf is to the right
            msp.add_blockref("DOOR", _mm(hinge), dxfattribs={
                "layer": "A-DOOR", "xscale": width, "yscale": width * flip, "rotation": ang})

    rng = random.Random(seed)
    for rid, region in lay.room_regions.items():
        room = plan.rooms[rid]
        c = region.representative_point()
        msp.add_text(room["name"].upper(), height=180, dxfattribs={"layer": "A-AREA-IDEN"}).set_placement(
            _mm((c.x, c.y + 0.2)), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        msp.add_text(f"{region.area:.1f} m2", height=120, dxfattribs={"layer": "A-AREA-IDEN"}).set_placement(
            _mm((c.x, c.y - 0.15)), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
        minx, miny, maxx, maxy = region.bounds
        if room["use"] == "bedroom":                     # a bed against the west wall, touching it
            msp.add_lwpolyline([_mm(p) for p in ((minx, miny + 0.6), (minx + 2.0, miny + 0.6),
                                                 (minx + 2.0, miny + 2.1), (minx, miny + 2.1))],
                               close=True, dxfattribs={"layer": "A-FURN"})
        elif room["use"] == "toilet":
            hatch = msp.add_hatch(dxfattribs={"layer": "A-FLOR-PATT"})
            hatch.set_pattern_fill("NET", scale=300.0 / 25.4)
            hatch.paths.add_polyline_path([_mm(p) for p in list(region.exterior.coords)[:-1]], is_closed=True)
        elif room["use"] in ("living", "dining"):
            w, d = 1.8, 0.9
            x0 = minx + (maxx - minx - w) * rng.uniform(0.2, 0.8)
            y0 = miny + (maxy - miny - d) * rng.uniform(0.2, 0.8)
            msp.add_lwpolyline([_mm(p) for p in ((x0, y0), (x0 + w, y0), (x0 + w, y0 + d), (x0, y0 + d))],
                               close=True, dxfattribs={"layer": "A-FURN"})

    minx, miny, maxx, maxy = lay.footprint.bounds
    dim = msp.add_linear_dim(base=_mm((minx, miny - 0.8)), p1=_mm((minx, miny)), p2=_mm((maxx, miny)),
                             dxfattribs={"layer": "A-ANNO-DIMS"})
    dim.render()
    out_dxf = Path(out_dxf)
    out_dxf.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(out_dxf)
    return {"overall_x_m": maxx - minx, "style": style}


if __name__ == "__main__":                                # python -m bench.dxf_drawing plan.json out.dxf [style]
    import sys
    write(sys.argv[1], sys.argv[2], *sys.argv[3:4])
