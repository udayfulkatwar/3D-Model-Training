"""Stacked levels and stairs (T-014): T05 builds clean, and each new check
fails on the defect it exists to catch."""

import copy
import json

import numpy as np
import pytest
import trimesh

from conftest import ROOT, details, item
from plan3d import plan2d, qa, stairs
from plan3d.mesh3d import Part, build_parts
from plan3d.model import Plan

T05 = json.loads((ROOT / "projects" / "t05" / "plan.json").read_text())


@pytest.fixture
def t05():
    return copy.deepcopy(T05)


def test_t05_builds_clean(t05, run):
    result, st = run(t05)
    assert result.ok and "FAIL" not in st.values() and "WARN" not in st.values()
    assert "R01 -> R11" in details(result, "Q21")                 # living room up to the stair hall
    assert "17 treads checked" in details(result, "Q22")


def test_single_level_plans_have_no_stair_findings(t01, run):
    result, st = run(t01)
    assert st["Q21"] == "PASS" and st["Q22"] == "PASS"


def test_stair_geometry_is_exact(t05):
    plan = Plan(t05)
    sg = stairs.build(plan)["S01"]
    assert sg.riser == pytest.approx(0.175) and sg.run == pytest.approx(4.25)
    solid = trimesh.Trimesh(*_mesh(stairs.solid(sg)))
    assert solid.is_watertight
    # stepped block: sum of 17 treads' columns, each riser*(k+1) high, going deep, 1 m wide
    assert solid.volume == pytest.approx(sum(0.175 * (k + 1) * 0.25 * 1.0 for k in range(17)))
    assert np.allclose(solid.bounds, [[6.77, 0.6, 0.0], [7.77, 4.85, 2.975]])


def _mesh(manifold):
    m = manifold.to_mesh64()
    return np.asarray(m.vert_properties)[:, :3], np.asarray(m.tri_verts)


def test_slab_between_floors_is_shared_not_doubled(t05):
    plan = Plan(t05)
    layouts = {lid: plan2d.build_layout(plan, lid) for lid in plan.levels}
    parts = {p.name: p for p in build_parts(plan, layouts)}
    assert parts["L00_WALLS"].solid.bounds[1][2] == pytest.approx(3.02)       # into the slab's ceiling layer
    assert parts["L01_WALLS"].solid.bounds[0][2] == pytest.approx(3.02)       # upper walls start on it
    assert parts["L01_FLOOR_R12"].solid.bounds[0][2] == pytest.approx(3.02)
    # under the full-cover first floor the ground ceilings are just the 20 mm layer
    assert parts["L00_CEILING_R02"].solid.bounds[:, 2] == pytest.approx([3.0, 3.02])
    # the stair opening goes through both layers
    hall = parts["L01_FLOOR_R11"].solid
    assert hall.area_faces[hall.face_normals[:, 2] > 0.999].sum() == pytest.approx(6.355156 - 4.25, abs=1e-5)
    from plan3d.walktests import Scene
    up_through_opening = Scene(list(parts.values())).first_hit_at([7.27, 2.0, 2.98], [7.27, 2.0, 3.2])
    assert up_through_opening == (None, 1.0)


def test_level_not_on_the_one_below_fails(t05, run):
    item(t05, "levels", "L01")["elevation"] = 3.30
    item(t05, "dimensions", "D-004")["value"] = 3.30
    result, st = run(t05)
    assert st["Q21"] == "FAIL" and "does not sit on a level below" in details(result, "Q21")


def test_stair_through_a_wall_fails(t05, run):
    item(t05, "stairs", "S01")["start"] = [7.5, 0.6]             # flight 23 cm into the east wall
    result, st = run(t05)
    assert st["Q21"] == "FAIL" and "crosses a wall" in details(result, "Q21")


def test_stair_landing_into_a_wall_fails(t05, run):
    item(t05, "stairs", "S01")["start"] = [7.27, 1.5]            # top riser at 5.75, wall face at 5.94
    result, st = run(t05)
    assert st["Q21"] in ("FAIL", "WARN")
    assert "landing" in details(result, "Q21")


def test_steep_stair_warns(t05, run):
    item(t05, "stairs", "S01")["risers"] = 15                    # 210 mm risers
    item(t05, "dimensions", "D-071")["value"] = 15
    result, st = run(t05)
    assert st["Q21"] == "WARN" and "riser 210 mm" in details(result, "Q21")


def test_upper_rooms_need_the_stair(t05, run):
    t05["stairs"] = []
    t05["dimensions"] = [d for d in t05["dimensions"] if d["id"] not in ("D-070", "D-071", "D-072")]
    for d in t05["dimensions"]:
        if d["id"] == "D-073":
            d["check"] = {"kind": "none"}
    result, st = run(t05)
    assert st["Q09"] == "FAIL" and "R11 (Stair hall) cannot be reached" in details(result, "Q09")


def test_low_headroom_is_caught(t05):
    plan = Plan(t05)
    layouts = {lid: plan2d.build_layout(plan, lid) for lid in plan.levels}
    beam = trimesh.creation.box(extents=(1.2, 0.3, 0.3))
    beam.apply_translation([7.27, 2.0, 3.0])                     # a beam across the flight
    report = qa.Report()
    qa.check_headroom(report, plan, build_parts(plan, layouts) + [Part("L00_BEAM", "wall", "L00", beam)])
    assert report.get("Q22").status == "FAIL" and "L00_BEAM" in "\n".join(report.get("Q22").details)


def test_stair_walk_line_is_clear(t05):
    from plan3d import walktests
    plan = Plan(t05)
    layouts = {lid: plan2d.build_layout(plan, lid) for lid in plan.levels}
    results = walktests.run(walktests.generate(plan, layouts), build_parts(plan, layouts))
    stair = next(r for r in results if r["kind"] == "stair")
    assert stair["ok"] and all(r["ok"] for r in results)
