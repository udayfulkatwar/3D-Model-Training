"""Blender worker for FBX export and verification. Runs in its own process.

    python -m plan3d.fbx_worker export <parts.npz> <parts.json> <out.fbx>
    python -m plan3d.fbx_worker verify <in.fbx> <report.json>

Kept separate from plan3d because Blender's Python module (bpy) is GPL-3.0:
plan3d only exchanges files with this worker and never imports bpy itself.
See ADR-010 before distributing this tool outside the company.
"""

from __future__ import annotations

import json
import sys

import numpy as np


def _reset(scale_length: float = 1.0):
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene.unit_settings
    s.system, s.scale_length = "METRIC", scale_length


def export(npz_path: str, meta_path: str, out_fbx: str) -> None:
    import bpy
    # Work in centimetres (1 Blender unit = 1 cm) so the FBX stores Unreal's
    # native unit with UnitScaleFactor = 1: it imports 1:1 whatever the
    # importer's unit-conversion setting.
    _reset(scale_length=0.01)
    data = np.load(npz_path)
    meta = json.loads(open(meta_path).read())
    mats = {}
    for m in meta["materials"]:
        mat = bpy.data.materials.new(m["name"])
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = m["color"]
        bsdf.inputs["Roughness"].default_value = m["roughness"]
        bsdf.inputs["Metallic"].default_value = 0.0
        if m["color"][3] < 1.0:
            bsdf.inputs["Alpha"].default_value = m["color"][3]
            mat.surface_render_method = "BLENDED"
        mat.diffuse_color = m["color"]
        mats[m["name"]] = mat
    for p in meta["parts"]:
        v, f, uv = data[f"{p['name']}:v"], data[f"{p['name']}:f"], data[f"{p['name']}:uv"]
        mesh = bpy.data.meshes.new(p["name"])
        mesh.from_pydata((v * 100.0).tolist(), [], f.tolist())        # metres -> cm
        layer = mesh.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", uv.reshape(-1))          # per face corner, in loop order
        mesh.polygons.foreach_set("use_smooth", [False] * len(mesh.polygons))
        mesh.materials.append(mats[p["material"]])
        if mesh.validate(verbose=False):
            raise RuntimeError(f"{p['name']}: Blender had to repair the mesh")
        obj = bpy.data.objects.new(p["name"], mesh)
        bpy.context.scene.collection.objects.link(obj)
    bpy.ops.export_scene.fbx(
        filepath=out_fbx, use_selection=False, object_types={"MESH"},
        apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z", axis_up="Y", mesh_smooth_type="FACE",
        use_mesh_modifiers=False, add_leaf_bones=False, bake_anim=False,
        use_custom_props=False, path_mode="AUTO")


def _header(fbx_path: str) -> dict:
    """GlobalSettings as Unreal will read them (units, axes)."""
    from io_scene_fbx import parse_fbx
    root, _ = parse_fbx.parse(fbx_path)
    out = {}
    for el in root.elems:
        if el.id == b"GlobalSettings":
            for sub in el.elems:
                if sub.id == b"Properties70":
                    for prop in sub.elems:
                        name = prop.props[0].decode()
                        if name in ("UpAxis", "UpAxisSign", "FrontAxis", "FrontAxisSign", "CoordAxis",
                                    "CoordAxisSign", "UnitScaleFactor", "OriginalUnitScaleFactor"):
                            out[name] = prop.props[4]
    return out


def _raw_extent(fbx_path: str) -> float:
    """Largest absolute vertex coordinate stored in the file (unit check)."""
    from io_scene_fbx import parse_fbx
    root, _ = parse_fbx.parse(fbx_path)
    biggest = 0.0
    for el in root.elems:
        if el.id == b"Objects":
            for obj in el.elems:
                if obj.id == b"Geometry":
                    for sub in obj.elems:
                        if sub.id == b"Vertices":
                            biggest = max(biggest, float(np.abs(np.asarray(sub.props[0])).max()))
    return biggest


def verify(fbx_path: str, report_path: str) -> None:
    import bpy
    _reset(scale_length=1.0)                 # re-import into metres to compare with the build
    bpy.ops.import_scene.fbx(filepath=fbx_path)
    objects = {}
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        corners = np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
        objects[obj.name] = {
            "triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons),
            "max_polygon_sides": max((len(p.vertices) for p in obj.data.polygons), default=0),
            "bounds": [corners.min(0).tolist(), corners.max(0).tolist()],
            "uv_layers": len(obj.data.uv_layers),
            "materials": [m.name for m in obj.data.materials if m],
        }
    json.dump({"objects": objects, "header": _header(fbx_path), "raw_extent": _raw_extent(fbx_path)},
              open(report_path, "w"), indent=1, default=float)


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"export": export, "verify": verify}[cmd](*args)
