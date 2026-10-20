"""3D solids from a 2D layout, built with exact booleans (manifold3d).

Stacking per level (z relative to the level's finished floor, FFL):
  walls     FFL - floor_thickness  ..  FFL + wall_height + roof_thickness
  floors    FFL - floor_thickness  ..  FFL           (one per room, inside wall faces)
  ceilings  FFL + wall_height      ..  + roof_thickness (one per room)
Floors and ceilings never sit under or over a wall, so no two visible faces
share a plane (lesson L-002).

Stacked levels (T-014): the slab between a level and the one above is split.
Its lowest CEILING_LAYER belongs to the lower level (ceiling plaster under
every lower room, the lower walls running up into it); the rest belongs to
the upper level (its floors and walls). Where the upper level does not cover
the lower one (terrace), the lower ceiling and walls fill the whole slab
as a roof. Stair openings cut both layers.
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import trimesh
from shapely import unary_union
from shapely.geometry import Polygon, box

from . import plan2d, stairs
from .model import Plan
from .plan2d import LevelLayout

GLASS_INSET = 0.002      # glazing inset from reveals or frame, metres
GLASS_THICKNESS = 0.01
LEAF_FLOOR_GAP = 0.01    # door leaf clears the floor
LEAF_HEAD_GAP = 0.005    # and the frame head
CEILING_LAYER = 0.02     # lower level's share of a slab between stacked levels
STACK_TOL = 1e-6

# Plan frame is Z-up; glTF 2.0 is Y-up. (x, y, z) -> (x, z, -y):
# plan east (+X) stays +X, plan north (+Y) becomes glTF -Z, up becomes +Y.
ZUP_TO_YUP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)

MATERIALS = {
    "wall":    {"baseColorFactor": [0.93, 0.92, 0.89, 1.0], "roughnessFactor": 0.9},
    "floor":   {"baseColorFactor": [0.78, 0.72, 0.64, 1.0], "roughnessFactor": 0.6},
    "ceiling": {"baseColorFactor": [0.97, 0.97, 0.97, 1.0], "roughnessFactor": 0.95},
    "frame":   {"baseColorFactor": [0.30, 0.20, 0.13, 1.0], "roughnessFactor": 0.55},
    "door":    {"baseColorFactor": [0.55, 0.40, 0.27, 1.0], "roughnessFactor": 0.5},
    "glass":   {"baseColorFactor": [0.70, 0.82, 0.90, 0.30], "roughnessFactor": 0.05,
                "alphaMode": "BLEND"},
    "stair":   {"baseColorFactor": [0.62, 0.60, 0.57, 1.0], "roughnessFactor": 0.7},
}


@dataclass
class Part:
    name: str
    role: str                 # key into MATERIALS
    level: str
    solid: trimesh.Trimesh    # merged, Z-up, metres (for QA)
    ref: str = ""             # room / opening id it belongs to


def _cross_section(poly: Polygon) -> m3d.CrossSection:
    rings = [np.asarray(poly.exterior.coords[:-1], float)]
    rings += [np.asarray(r.coords[:-1], float) for r in poly.interiors]
    return m3d.CrossSection(rings, m3d.FillRule.EvenOdd)


def _polygons(geom) -> list[Polygon]:
    """The polygons in any shapely result (boolean leftovers can be lines or points)."""
    if geom.geom_type == "Polygon":
        return [geom] if geom.area > 1e-12 else []
    return [p for g in getattr(geom, "geoms", []) for p in _polygons(g)]


def _prism(geom, z0: float, z1: float) -> m3d.Manifold:
    solid = m3d.Manifold()
    for p in _polygons(geom):
        solid = solid + m3d.Manifold.extrude(_cross_section(p), z1 - z0).translate([0, 0, z0])
    return solid


def _to_trimesh(solid: m3d.Manifold) -> trimesh.Trimesh:
    mesh = solid.to_mesh64()
    return trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3],
                           np.asarray(mesh.tri_verts), process=True)


def stacking(plan: Plan) -> dict[str, str]:
    """{level id: id of the level directly above it} for levels that stack:
    the upper floor level equals the lower ceiling plus its slab, and the
    upper floor thickness equals that slab (Q21 reports levels that don't)."""
    above = {}
    for lo in plan.levels.values():
        for up in plan.levels.values():
            if (abs(up["elevation"] - (lo["elevation"] + lo["wall_height"] + lo["roof_thickness"])) < STACK_TOL
                    and abs(up["floor_thickness"] - lo["roof_thickness"]) < STACK_TOL):
                above[lo["id"]] = up["id"]
    return above


def _spaces(lay: LevelLayout) -> list[tuple[str, Polygon]]:
    spaces = [(rid, poly) for rid, poly in sorted(lay.room_regions.items())]
    return spaces + [(f"UNASSIGNED{i}", poly) for i, poly in enumerate(lay.unassigned)]


def build_parts(plan: Plan, layouts: dict[str, LevelLayout]) -> list[Part]:
    parts: list[Part] = []
    above = {lo: up for lo, up in stacking(plan).items() if lo in layouts and up in layouts}
    below = {up: lo for lo, up in above.items()}
    flights = stairs.build(plan)
    voids = {lid: unary_union([sg.footprint for sg in flights.values() if sg.to_level == lid])
             for lid in layouts}
    for level_id, lay in layouts.items():
        lv = plan.levels[level_id]
        ffl, h = lv["elevation"], lv["wall_height"]
        z_bot, z_top = ffl - lv["floor_thickness"], ffl + h + lv["roof_thickness"]
        if level_id in below:
            z_bot += CEILING_LAYER                     # the layer under this floor is the ceiling below
        z_mid = ffl + h + CEILING_LAYER
        up = above.get(level_id)
        if up is not None:                             # what the level above puts into the shared slab
            cover = unary_union([*(p.difference(voids[up]) for _, p in _spaces(layouts[up])),
                                 layouts[up].footprint])
            up_void = voids[up]

        if up is None:
            walls = _prism(lay.footprint, z_bot, z_top)
        else:
            walls = _prism(lay.footprint, z_bot, z_mid) + _prism(lay.footprint.difference(cover), z_mid, z_top)
        for og in lay.openings.values():
            walls = walls - _prism(og.cut_rect, ffl + og.sill, ffl + og.head)
        parts.append(Part(f"{level_id}_WALLS", "wall", level_id, _to_trimesh(walls)))

        for rid, poly in _spaces(lay):
            parts.append(Part(f"{level_id}_FLOOR_{rid}", "floor", level_id,
                              _to_trimesh(_prism(poly.difference(voids[level_id]), z_bot, ffl)), rid))
            if up is None:
                ceiling = _prism(poly, ffl + h, z_top)
            else:
                ceiling = (_prism(poly.difference(up_void), ffl + h, z_mid)
                           + _prism(poly.difference(cover).difference(up_void), z_mid, z_top))
            if not ceiling.is_empty():
                parts.append(Part(f"{level_id}_CEILING_{rid}", "ceiling", level_id, _to_trimesh(ceiling), rid))
        for sg in sorted(flights.values(), key=lambda s: s.id):
            if sg.level == level_id:
                for suffix, lane in stairs.solids(sg):
                    parts.append(Part(f"{level_id}_STAIR_{sg.id}{suffix}", "stair", level_id, _to_trimesh(lane), sg.id))

        details = next(iter(plan.details.values()), None)
        fw = details["frame_width"] if details else 0.0
        for og in sorted(lay.openings.values(), key=lambda o: o.id):
            if og.kind == "arch":
                continue
            wg = lay.walls[og.wall_id]
            if details:
                parts.append(Part(f"{level_id}_FRAME_{og.id}", "frame", level_id,
                                  _to_trimesh(_frame(wg, og, ffl, fw)), og.id))
            if og.kind == "window":
                pane = wg.strip(og.a + fw + GLASS_INSET, og.b - fw - GLASS_INSET, GLASS_THICKNESS / 2)
                z0, z1 = ffl + og.sill + fw + GLASS_INSET, ffl + og.head - fw - GLASS_INSET
                parts.append(Part(f"{level_id}_GLASS_{og.id}", "glass", level_id,
                                  _to_trimesh(_prism(pane, z0, z1)), og.id))
            elif details:
                parts.append(Part(f"{level_id}_DOOR_{og.id}", "door", level_id,
                                  _to_trimesh(_open_leaf(lay, wg, og, ffl, fw, details["door_leaf_thickness"])),
                                  og.id))
    return parts


def _frame(wg, og, ffl: float, fw: float) -> m3d.Manifold:
    """Frame lining the opening's reveals: jambs and head (U shape) for doors,
    plus a sill (closed ring) for windows. Built as one profile in the wall's
    vertical plane and extruded through the wall thickness: unioning boxes
    with coincident faces leaves sliver triangles (lesson L-004)."""
    z0, z1 = ffl + og.sill, ffl + og.head
    outer = box(og.a, z0, og.b, z1)
    inner = box(og.a + fw, z0 + fw if og.kind == "window" else z0 - 1.0, og.b - fw, z1 - fw)
    solid = m3d.Manifold.extrude(_cross_section(outer.difference(inner)), wg.thickness)
    # local (along, z, depth) -> world; depth runs across the wall from face to face
    d, n, t = wg.direction, wg.normal, wg.thickness
    origin = wg.start - n * t / 2
    return solid.transform(np.array([[d[0], 0.0, n[0], origin[0]],
                                     [d[1], 0.0, n[1], origin[1]],
                                     [0.0, 1.0, 0.0, 0.0]]))


def _open_leaf(lay, wg, og, ffl: float, fw: float, thickness: float) -> m3d.Manifold:
    """Door leaf standing open at 90 degrees into the room it opens into,
    so walkthroughs pass freely."""
    h, u = plan2d.door_hinge(lay, og, inset=fw)
    n = wg.normal * plan2d.door_side(og)
    width = og.b - og.a - 2 * fw
    leaf = Polygon([h, h + n * width, h + n * width + u * thickness, h + u * thickness])
    return _prism(leaf, ffl + LEAF_FLOOR_GAP, ffl + og.head - fw - LEAF_HEAD_GAP)


def box_uv_mesh(solid: trimesh.Trimesh) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unweld faces and assign world-space box-projected UVs (1 UV unit = 1 m).

    Returns (vertices, faces, uv). Every face gets UVs (lesson L-001).
    """
    tris = solid.triangles.reshape(-1, 3)
    axis = np.repeat(np.abs(solid.face_normals).argmax(axis=1), 3)
    drop_to_uv = {0: (1, 2), 1: (0, 2), 2: (0, 1)}
    uv = np.empty((len(tris), 2))
    for ax, (u, v) in drop_to_uv.items():
        sel = axis == ax
        uv[sel] = tris[sel][:, [u, v]]
    faces = np.arange(len(tris)).reshape(-1, 3)
    return tris, faces, uv


def export_scene(parts: list[Part]) -> trimesh.Scene:
    """Scene in glTF convention (Y-up, metres), one named node per part."""
    scene = trimesh.Scene()
    mats = {k: trimesh.visual.material.PBRMaterial(name=k, metallicFactor=0.0, **v)
            for k, v in MATERIALS.items()}
    for part in parts:
        verts, faces, uv = box_uv_mesh(part.solid)
        verts = trimesh.transform_points(verts, ZUP_TO_YUP)
        mesh = trimesh.Trimesh(verts, faces, process=False,
                               visual=trimesh.visual.TextureVisuals(uv=uv, material=mats[part.role]))
        scene.add_geometry(mesh, node_name=part.name, geom_name=part.name)
    return scene
