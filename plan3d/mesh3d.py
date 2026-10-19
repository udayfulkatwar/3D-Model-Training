"""3D solids from a 2D layout, built with exact booleans (manifold3d).

Stacking per level (z relative to the level's finished floor, FFL):
  walls     FFL - floor_thickness  ..  FFL + wall_height + roof_thickness
  floors    FFL - floor_thickness  ..  FFL           (one per room, inside wall faces)
  ceilings  FFL + wall_height      ..  + roof_thickness (one per room)
Floors and ceilings never sit under or over a wall, so no two visible faces
share a plane (lesson L-002).
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import trimesh
from shapely.geometry import Polygon

from .model import Plan
from .plan2d import LevelLayout

GLASS_INSET = 0.002      # glazing inset from reveals, metres
GLASS_THICKNESS = 0.01

# Plan frame is Z-up; glTF 2.0 is Y-up. (x, y, z) -> (x, z, -y):
# plan east (+X) stays +X, plan north (+Y) becomes glTF -Z, up becomes +Y.
ZUP_TO_YUP = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)

MATERIALS = {
    "wall":    {"baseColorFactor": [0.93, 0.92, 0.89, 1.0], "roughnessFactor": 0.9},
    "floor":   {"baseColorFactor": [0.78, 0.72, 0.64, 1.0], "roughnessFactor": 0.6},
    "ceiling": {"baseColorFactor": [0.97, 0.97, 0.97, 1.0], "roughnessFactor": 0.95},
    "glass":   {"baseColorFactor": [0.70, 0.82, 0.90, 0.30], "roughnessFactor": 0.05,
                "alphaMode": "BLEND"},
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


def _prism(geom, z0: float, z1: float) -> m3d.Manifold:
    polys = list(getattr(geom, "geoms", [geom]))
    solid = m3d.Manifold()
    for p in polys:
        solid = solid + m3d.Manifold.extrude(_cross_section(p), z1 - z0).translate([0, 0, z0])
    return solid


def _to_trimesh(solid: m3d.Manifold) -> trimesh.Trimesh:
    mesh = solid.to_mesh64()
    return trimesh.Trimesh(np.asarray(mesh.vert_properties)[:, :3],
                           np.asarray(mesh.tri_verts), process=True)


def build_parts(plan: Plan, layouts: dict[str, LevelLayout]) -> list[Part]:
    parts: list[Part] = []
    for level_id, lay in layouts.items():
        lv = plan.levels[level_id]
        ffl, h = lv["elevation"], lv["wall_height"]
        z_bot, z_top = ffl - lv["floor_thickness"], ffl + h + lv["roof_thickness"]

        walls = _prism(lay.footprint, z_bot, z_top)
        for og in lay.openings.values():
            walls = walls - _prism(og.cut_rect, ffl + og.sill, ffl + og.head)
        parts.append(Part(f"{level_id}_WALLS", "wall", level_id, _to_trimesh(walls)))

        spaces = [(rid, poly) for rid, poly in sorted(lay.room_regions.items())]
        spaces += [(f"UNASSIGNED{i}", poly) for i, poly in enumerate(lay.unassigned)]
        for rid, poly in spaces:
            parts.append(Part(f"{level_id}_FLOOR_{rid}", "floor", level_id,
                              _to_trimesh(_prism(poly, z_bot, ffl)), rid))
            parts.append(Part(f"{level_id}_CEILING_{rid}", "ceiling", level_id,
                              _to_trimesh(_prism(poly, ffl + h, z_top)), rid))

        for og in sorted(lay.openings.values(), key=lambda o: o.id):
            if og.kind != "window":
                continue
            wg = lay.walls[og.wall_id]
            pane = wg.strip(og.a + GLASS_INSET, og.b - GLASS_INSET, GLASS_THICKNESS / 2)
            solid = _prism(pane, ffl + og.sill + GLASS_INSET, ffl + og.head - GLASS_INSET)
            parts.append(Part(f"{level_id}_GLASS_{og.id}", "glass", level_id,
                              _to_trimesh(solid), og.id))
    return parts


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
