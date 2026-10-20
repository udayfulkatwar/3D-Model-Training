"""Plan reader regression tests: the hardest benchmark cases must keep
meeting the pre-registered targets (docs/T006_PLAN_READING.md)."""

import json

import pytest

from bench.drawing import degrade, render
from bench.run import ROOT, score, verdict
from plan3d.read_raster import _odd, read_plan


def _read_case(tmp_path, plan_id, ppm, scan=None, pen_m=None, style="poche"):
    truth = ROOT / "projects" / plan_id / "plan.json"
    img = tmp_path / "drawing.png"
    info = render(truth, img, ppm, style=style, **({"pen_m": pen_m} if pen_m else {}))
    if scan is not None:
        degrade(img, tmp_path / "drawing.jpg", **scan)
        img = tmp_path / "drawing.jpg"
    res = read_plan(img, tmp_path / "draft", known_width_m=info["overall_x_m"])
    return res, score(truth, tmp_path / "draft" / "plan.json")


@pytest.mark.parametrize("plan_id,ppm,scan,pen_m,case", [
    ("t02", 60, None, None, "clean-60"),            # short toilet wall made of nibs
    ("t01", 100, {}, None, "scan-100"),             # 1.5 deg skew, blur, noise, JPEG
    ("t03", 60, None, None, "clean-60"),            # dashed arch at low resolution
    ("t03", 100, {}, 0.03, "thickpen-scan-100"),    # thick pen vs 100 mm walls
    ("t04", 150, {"rotate_deg": -2.5, "blur": 1.2, "noise": 18.0, "jpeg": 50, "seed": 11}, None, "scan2-150"),
])
def test_hard_cases_meet_targets(tmp_path, plan_id, ppm, scan, pen_m, case):
    _, m = _read_case(tmp_path, plan_id, ppm, scan, pen_m)
    v = verdict(m, case)
    assert v["pass"], (v["missed"], m["missed"], m["spurious"], m["wrong_kind"])


@pytest.mark.parametrize("plan_id,ppm,scan,case", [
    ("t01", 100, None, "hollow-clean-100"),         # 150 mm pier between a door and a window
    ("t02", 60, None, "hollow-clean-60"),           # toilet hatching against a hollow wall
    ("t02", 100, {}, "hollow-scan-100"),            # blurred outlines: pen width from summed darkness
    ("t05", 100, None, "hollow-clean-100"),         # 0.7 m wall piece between a door and a window
    ("t04", 100, None, "hollow-clean-100"),         # door leaf beside a furniture line is not a wall
])
def test_hollow_walls_meet_targets(tmp_path, plan_id, ppm, scan, case):
    res, m = _read_case(tmp_path, plan_id, ppm, scan, style="hollow")
    assert res.stats["hollow_walls"]
    v = verdict(m, case)
    assert v["pass"], (v["missed"], m["missed"], m["spurious"], m["wrong_kind"])


def test_hollow_t_shaped_wall_survives_low_resolution(tmp_path):
    # wall length was once underestimated 2-3x at low resolution, dropping these doors
    _, m = _read_case(tmp_path, "t04", 80, style="hollow")
    assert m["recall"] == 1.0 and m["rooms"] == 1.0, (m["missed"], m["spurious"])


def test_filled_walls_are_not_read_as_hollow(tmp_path):
    res, _ = _read_case(tmp_path, "t03", 100, {}, pen_m=0.03)    # thick pen once tripped the hollow test
    assert not res.stats["hollow_walls"]


def test_reader_never_confirms_what_it_measured(tmp_path):
    res, _ = _read_case(tmp_path, "t02", 100)
    statuses = {d["id"]: d["status"] for d in res.plan["dimensions"]}
    assert statuses.pop("D-001") == "CONFIRMED"          # the reviewer's scale only
    assert set(statuses.values()) <= {"INFERRED", "OPEN"}
    assert all(r["use"] == "other" and r["name"].startswith("Room ") for r in res.plan["rooms"])
    assert (tmp_path / "draft" / "review.md").read_text().count("Nothing here is confirmed") == 1


def test_pixel_scale_leaves_overall_size_inferred(tmp_path):
    truth = ROOT / "projects" / "t02" / "plan.json"
    render(truth, tmp_path / "d.png", 100)
    res = read_plan(tmp_path / "d.png", tmp_path / "draft", px_per_m=100)
    d001 = next(d for d in res.plan["dimensions"] if d["id"] == "D-001")
    assert d001["status"] == "INFERRED" and d001["value"] == pytest.approx(10.0, abs=0.01)


def test_free_standing_wall_is_not_extended(tmp_path):
    res, _ = _read_case(tmp_path, "t04", 100)
    truth = json.loads((ROOT / "projects" / "t04" / "plan.json").read_text())
    wing = next(w for w in truth["walls"] if w["id"] == "W07")
    assert any(w["start"] == wing["start"] and w["end"] == wing["end"] for w in res.plan["walls"])


def test_kernels_are_always_odd():
    assert all(_odd(n) % 2 == 1 and _odd(n) >= n for n in range(1, 40))
