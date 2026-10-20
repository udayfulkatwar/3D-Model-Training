"""T-013: frames, open door leaves and door-swing clearance (Q18)."""

import json

import pytest

from conftest import details, item


def _bounds(result, name):
    """[xmin, ymin, zmin, xmax, ymax, zmax] of a built part, metres."""
    m = json.loads((result.out_dir / "manifest.json").read_text())
    lo, hi = next(x["bounds_zup_m"] for x in m["meshes"] if x["name"] == name)
    return lo + hi


def test_plans_without_details_build_as_before(t01, run):
    del t01["details"]
    t01["dimensions"] = [d for d in t01["dimensions"] if d["id"] not in ("D-095", "D-096")]
    result, st = run(t01)
    assert result.ok
    names = {x["name"] for x in json.loads((result.out_dir / "manifest.json").read_text())["meshes"]}
    assert len(names) == 24 and not any("_FRAME_" in n or "_DOOR_" in n for n in names)


def test_frame_and_glass_sit_inside_the_structural_opening(t01, run):
    result, _ = run(t01)
    # O02: living window on W01 (y = 0.115, 230 mm), x 3.85-5.35, sill 0.9, head 2.1, frame 60 mm
    assert _bounds(result, "L00_FRAME_O02") == pytest.approx([3.85, 0.0, 0.9, 5.35, 0.23, 2.1], abs=1e-9)
    assert _bounds(result, "L00_GLASS_O02") == pytest.approx(
        [3.912, 0.11, 0.962, 5.288, 0.12, 2.038], abs=1e-9)


def test_leaf_opens_into_the_room_it_should(t01, run):
    result, _ = run(t01)
    # O01 main door, hinge at x 5.5 + 60 mm frame, opens north (+y) into the living room
    assert _bounds(result, "L00_DOOR_O01") == pytest.approx([5.56, 0.23, 0.01, 5.595, 1.11, 2.035], abs=1e-9)


def test_hinge_end_moves_the_leaf_to_the_other_jamb(t01, run):
    item(t01, "openings", "O01")["hinge"] = "end"
    result, st = run(t01)
    assert result.ok
    assert _bounds(result, "L00_DOOR_O01") == pytest.approx([6.405, 0.23, 0.01, 6.44, 1.11, 2.035], abs=1e-9)


def test_door_swinging_into_a_wall_is_flagged(t01, run):
    # O11 (Bedroom 1 door on W05) moved next to W08 with its hinge on that side:
    # the leaf now sweeps into wall W08.
    o = item(t01, "openings", "O11")
    o["center"], o["hinge"] = 4.0, "end"
    result, st = run(t01)
    assert st["Q18"] == "WARN" and "hits wall W08" in details(result, "Q18")


def test_overlapping_door_swings_are_flagged(t01, run):
    # Toilet 1 is 1.685 m wide. Two 900 mm doors facing each other across it
    # (O14 from Bedroom 1 on W08, a new O16 from Dining on W09) both swing in.
    item(t01, "openings", "O14")["width"] = 0.9
    t01["openings"].append({**item(t01, "openings", "O14"), "id": "O16", "wall": "W09", "opens_into": "R05"})
    result, st = run(t01)
    assert st["Q18"] == "WARN" and "O16 and O14: door swings overlap" in details(result, "Q18")


def test_details_values_are_checked_against_the_register(t01, run):
    t01["details"][0]["frame_width"] = 0.08                  # register D-095 says 60 mm
    result, st = run(t01)
    assert st["Q08"] == "FAIL" and "D-095" in details(result, "Q08")
