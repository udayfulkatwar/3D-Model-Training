"""Read an AutoCAD DXF floor plan into a DRAFT plan.json for human review (T-016).

Vectors are exact, but drafting habits vary, so the layers do the sorting
and the proven image reader does the measuring:

  1. units from the file header ($INSUNITS) or the reviewer
  2. wall outlines from layers named like WALL or COLUMN/COLS (columns of a
     framed building close the walls' outlines; hatch layers ignored);
     line ends are extended by GAP_M so near-misses meet; outlines are noded
     and turned into faces (loose ends drop out); thin faces are wall, wide
     faces are rooms
  3. a clean drawing is rendered from the walls (filled) and the door and
     window layers only, so furniture, hatching, text and dimensions can
     never be mistaken for walls or openings
  4. plan3d.read_raster reads that drawing at its exact scale
  5. room names come from the TEXT/MTEXT inside each room; uses are guessed
     from the names

Nothing read is CONFIRMED: see docs/T016_DXF_INTAKE.md.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

import cv2
import ezdxf
import numpy as np
import shapely
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union

from . import plan2d
from .model import Plan
from .read_raster import HOLLOW_MAX_WALL_M, ReadResult, read_plan

UNITS_M = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0}    # $INSUNITS: inch, foot, mm, cm, m
WALL_LAYER = re.compile(r"WALL|COLUMN|(^|[-_ ])COLS?($|[-_ ])", re.I)   # RCC columns close the wall outlines
SKIP_LAYER = re.compile(r"PATT|HATCH|HIDN|HIDDEN", re.I)
DOOR_LAYER = re.compile(r"DOOR", re.I)
WINDOW_LAYER = re.compile(r"WIND|GLAZ", re.I)
PX_PER_M = 200.0
SUPERSAMPLE = 4
MARGIN_M = 1.0
NODE_M = 0.001            # outlines are snapped to 1 mm so touching ends meet exactly
GAP_M = 0.01              # line ends are extended this far, so ends that just miss still meet
ORTHO_DEG = 0.5
USES = [(r"BED|MASTER|GUEST", "bedroom"), (r"KITCHEN|KIT\b", "kitchen"), (r"TOILET|BATH|W\.?C\b|WASH", "toilet"),
        (r"DINING", "dining"), (r"LIVING|HALL|DRAWING|LOUNGE|FAMILY", "living"),
        (r"PASSAGE|LOBBY|CORRIDOR|FOYER|STAIR", "circulation"), (r"UTILITY|STORE|WASH ?AREA", "utility")]


@dataclass
class DxfText:
    text: str
    xy: tuple[float, float]


def _xy(v) -> tuple[float, float]:
    return float(v[0]), float(v[1])


def _primitives(entity, unit: float) -> list[np.ndarray]:
    """Polylines (n x 2, metres) for a LINE, (LW)POLYLINE, ARC, CIRCLE or a block
    insert's contents."""
    kind = entity.dxftype()
    if kind == "INSERT":
        return [p for e in entity.virtual_entities() for p in _primitives(e, unit)]
    if kind == "LINE":
        return [np.array([_xy(entity.dxf.start), _xy(entity.dxf.end)]) * unit]
    if kind in ("LWPOLYLINE", "POLYLINE"):
        pts = [_xy(v) for v in (entity.get_points("xy") if kind == "LWPOLYLINE" else entity.points())]
        if entity.is_closed and len(pts) > 2:
            pts = [*pts, pts[0]]
        return [np.asarray(pts, float) * unit] if len(pts) > 1 else []
    if kind in ("ARC", "CIRCLE"):
        return [np.asarray([_xy(v) for v in entity.flattening(sagitta=0.002 / unit)]) * unit]
    return []


def _texts(msp, unit: float) -> list[DxfText]:
    out = []
    for e in msp.query("TEXT MTEXT"):
        text = e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text
        p = e.dxf.insert if e.dxftype() == "MTEXT" else (
            e.dxf.align_point if e.dxf.halign or e.dxf.valign else e.dxf.insert)
        out.append(DxfText(text.strip(), (p[0] * unit, p[1] * unit)))
    return out


def wall_area(msp, unit: float, layers: re.Pattern = WALL_LAYER) -> shapely.Geometry:
    """Wall material: faces enclosed by the wall outlines that are thin."""
    segs = []
    for e in msp:
        layer = e.dxf.layer
        if not layers.search(layer) or SKIP_LAYER.search(layer) or e.dxftype() == "HATCH":
            continue
        for poly in _primitives(e, unit):
            for a, b in zip(poly, poly[1:]):
                d = b - a
                if np.hypot(*d) < NODE_M:
                    continue
                ang = abs(np.degrees(np.arctan2(d[1], d[0]))) % 90
                if min(ang, 90 - ang) <= ORTHO_DEG:
                    u = d / np.hypot(*d)                # close small gaps: overshoots only leave loose ends
                    segs.append(LineString([a - u * GAP_M, b + u * GAP_M]))
    noded = unary_union(shapely.set_precision(shapely.MultiLineString(segs), NODE_M))
    faces = list(polygonize(noded))
    walls = [f for f in faces
             if shapely.length(shapely.maximum_inscribed_circle(f, NODE_M)) <= HOLLOW_MAX_WALL_M / 2]
    return unary_union(walls)


def _render(walls, symbols: list[np.ndarray], path: Path) -> None:
    """Walls filled, door/window symbols as 1 px lines. Drawn at SUPERSAMPLE x
    without anti-aliasing and shrunk by area averaging, so each pixel's
    darkness is the share of it covered: the reader's sub-pixel edges then
    land on the true faces (anti-aliased filling fattens walls by ~half a
    pixel a side)."""
    k = SUPERSAMPLE
    minx, miny, maxx, maxy = walls.bounds
    x0, y1 = minx - MARGIN_M, maxy + MARGIN_M
    w = int(np.ceil((maxx - minx + 2 * MARGIN_M) * PX_PER_M))
    h = int(np.ceil((maxy - miny + 2 * MARGIN_M) * PX_PER_M))
    to_px = lambda pts: np.round((np.c_[pts[:, 0] - x0, y1 - pts[:, 1]]) * PX_PER_M * k * 16).astype(np.int32)  # noqa: E731
    big = np.full((h * k, w * k), 255, np.uint8)
    for g in getattr(walls, "geoms", [walls]):
        cv2.fillPoly(big, [to_px(np.asarray(g.exterior.coords))], 0, cv2.LINE_8, shift=4)
        for hole in g.interiors:
            cv2.fillPoly(big, [to_px(np.asarray(hole.coords))], 255, cv2.LINE_8, shift=4)
    for pts in symbols:
        cv2.polylines(big, [to_px(pts)], False, 0, k, cv2.LINE_8, shift=4)
    cv2.imwrite(str(path), cv2.resize(big, (w, h), interpolation=cv2.INTER_AREA))


def _use(name: str) -> str:
    return next((use for pattern, use in USES if re.search(pattern, name, re.I)), "other")


def _name_rooms(plan: dict, texts: list[DxfText], origin: tuple[float, float]) -> int:
    """Name each draft room from the text inside it; returns how many were named."""
    lay = plan2d.build_layout(Plan(plan), "L00")
    named = 0
    for room in plan["rooms"]:
        region = lay.room_regions.get(room["id"])
        if region is None:
            continue
        inside = [t for t in texts if re.search(r"[A-Za-z]{3}", t.text) and not re.match(r"^[\d.,\s]+", t.text)
                  and region.contains(Point(t.xy[0] - origin[0], t.xy[1] - origin[1]))]
        if inside:
            room["name"] = " ".join(w.capitalize() if w.isupper() else w for w in inside[0].text.split())
            room["use"] = _use(inside[0].text)
            named += 1
    return named


def read_dxf(path: str | Path, out_dir: str | Path, unit_m: float | None = None,
             wall_layers: str | None = None, project_id: str = "DRAFT") -> ReadResult:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = ezdxf.readfile(str(path))
    msp = doc.modelspace()
    unit = unit_m if unit_m is not None else UNITS_M.get(int(doc.header.get("$INSUNITS", 0)))
    if unit is None:
        raise ValueError("the DXF does not state its units ($INSUNITS); give unit_m (e.g. 0.001 for mm)")
    walls = wall_area(msp, unit, re.compile(wall_layers, re.I) if wall_layers else WALL_LAYER)
    if walls.is_empty:
        raise ValueError("no closed wall outlines found on the wall layers")
    symbols = [p for e in msp if (DOOR_LAYER.search(e.dxf.layer) or WINDOW_LAYER.search(e.dxf.layer))
               and not SKIP_LAYER.search(e.dxf.layer) for p in _primitives(e, unit)]
    drawing = out_dir / "walls_and_openings.png"
    _render(walls, symbols, drawing)
    res = read_plan(drawing, out_dir, px_per_m=PX_PER_M, project_id=project_id)
    plan = res.plan
    minx, miny, _, _ = walls.bounds
    named = _name_rooms(plan, _texts(msp, unit), (minx, miny))
    plan["project"]["name"] = f"Draft read from {Path(path).name}"
    plan["project"]["notes"] = ("Generated by plan3d.read_dxf from CAD vectors (exact as drawn). "
                                "Every value is INFERRED until reviewed.")
    for d in plan["dimensions"]:
        if d["id"] == "D-001":
            d.update(status="INFERRED", note="Measured from the DXF at its stated units; confirm against the drawing")
        if d["id"] == "D-060":
            d["note"] = f"Room names read from the drawing's text for {named} of {len(plan['rooms'])} rooms; confirm"
        if d["id"] == "D-090" and named == len(plan["rooms"]):
            d.update(status="INFERRED", value=float(named),
                     note="Rooms named from the DXF's room-name text (value = rooms named); uses guessed from names")
    (out_dir / "plan.json").write_text(json.dumps(plan, indent=1) + "\n")
    res.stats.update({"source": "dxf", "unit_m": unit, "rooms_named": named})
    return res
