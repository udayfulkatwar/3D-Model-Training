"""FBX export for Unreal (T-009). Blender-dependent tests are skipped when
bpy is not installed (pip install -r requirements-fbx.txt)."""

import csv
import json

import numpy as np
import pytest
import shapely
import trimesh

from conftest import T01_PATH
from plan3d import export_fbx, qa
from plan3d.build import build
from plan3d.mesh3d import Part
from plan3d.model import load_plan

needs_blender = pytest.mark.skipif(not export_fbx.bpy_available(), reason="bpy not installed")


@needs_blender
def test_t01_exports_unreal_bundle(tmp_path):
    result = build(T01_PATH, tmp_path, fbx=True)
    assert result.ok
    st = {c.id: c.status for c in result.report.checks}
    assert st["Q17"] in ("PASS", "INFO")
    u = tmp_path / "unreal"
    assert {p.name for p in u.iterdir()} == {"T01.fbx", "unreal_manifest.json", "rooms.csv", "import_plan3d.py"}
    m = json.loads((u / "unreal_manifest.json").read_text())
    assert len(m["meshes"]) == 45 and all(n.startswith("SM_T01_L00_") for n in m["meshes"])
    assert abs(float(m["fbx_header"]["UnitScaleFactor"]) - 1.0) < 1e-6          # centimetres
    rows = list(csv.DictReader(open(u / "rooms.csv")))
    assert len(rows) == 8 and rows[0]["---"] == rows[0]["RoomID"]               # DataTable row names


@needs_blender
def test_player_start_is_inside_the_living_room(tmp_path):
    build(T01_PATH, tmp_path, fbx=True)
    m = json.loads((tmp_path / "unreal" / "unreal_manifest.json").read_text())
    x_cm, y_cm, z_cm = m["player_start_cm"]
    plan, _ = load_plan(T01_PATH)
    from plan3d.plan2d import build_layout
    living = build_layout(plan, "L00").room_regions["R01"]
    assert living.contains(shapely.Point(x_cm / 100, -y_cm / 100))   # undo Unreal's -Y
    assert z_cm == 100


def _fake_check(unit, stored_scale):
    part = Part("L00_WALLS", "wall", "L00", trimesh.creation.box(extents=(2, 2, 2)))
    plan, _ = load_plan(T01_PATH)
    name = export_fbx.asset_name(plan, part)
    check = {"objects": {name: {"triangles": 12, "max_polygon_sides": 3,
                                "bounds": part.solid.bounds.tolist(), "uv_layers": 1, "materials": ["M_Wall"]}},
             "header": {"UnitScaleFactor": unit}, "raw_extent": 1.0 * stored_scale}
    return plan, part, check


@pytest.mark.parametrize("unit,stored,fails", [(1.0, 100, False), (0.99999998, 100, False),
                                               (100.0, 1, True), (1.0, 1, True)])
def test_fbx_must_be_stored_in_centimetres(unit, stored, fails):
    plan, part, check = _fake_check(unit, stored)
    report = qa.Report()
    c = report.new("Q17", "FBX")
    export_fbx._check_fbx(c, plan, [part], check)
    assert (c.status == "FAIL") is fails


def test_missing_mesh_after_reimport_fails():
    plan, part, check = _fake_check(1.0, 100)
    check["objects"] = {}
    report = qa.Report()
    c = report.new("Q17", "FBX")
    export_fbx._check_fbx(c, plan, [part], check)
    assert c.status == "FAIL" and "missing" in "\n".join(c.details)


def test_unreal_axis_mapping_mirrors_north():
    assert export_fbx.to_unreal_cm(12.0, 10.0, 3.0) == [1200.0, -1000.0, 300.0]
    assert np.allclose(export_fbx._corner_uvs(trimesh.creation.box()).shape, (12, 3, 2))
