"""Each QA check must FAIL on the defect it exists to catch.

A check that has never been seen failing is not evidence of anything.
"""

import pytest

from conftest import details, item, remove_opening


def test_drawing_dimension_mismatch_is_caught(t01, run):
    item(t01, "dimensions", "D-060")["value"] += 0.05          # schedule says 50 mm wider
    result, st = run(t01)
    assert st["Q08"] == "FAIL" and not result.ok
    assert "D-060" in details(result, "Q08")


@pytest.mark.parametrize("delta,ok", [(0.004, True), (-0.004, True), (0.006, False), (-0.006, False)])
def test_length_tolerance_boundary(t01, run, delta, ok):
    item(t01, "dimensions", "D-066")["value"] += delta          # tolerance is 5 mm
    _, st = run(t01)
    assert (st["Q08"] != "FAIL") is ok


def test_area_tolerance_is_relative(t01, run):
    item(t01, "dimensions", "D-080")["value"] *= 1.02           # 2% > 1% tolerance
    result, st = run(t01)
    assert st["Q08"] == "FAIL" and "D-080" in details(result, "Q08")


def test_parameter_disagreeing_with_register_is_caught(t01, run):
    item(t01, "wall_types", "INT")["thickness"] = 0.1
    result, st = run(t01)
    assert st["Q08"] == "FAIL"
    assert "D-011" in details(result, "Q08")                  # the register value
    assert "D-060" in details(result, "Q08")                  # and the room sizes it moves


def test_geometry_built_on_open_question_is_rejected(t01, run):
    item(t01, "walls", "W01")["prov"].append("D-090")
    result, st = run(t01)
    assert st["Q03"] == "FAIL" and "W01" in details(result, "Q03")


def test_gap_in_envelope_blocks_the_build(t01, run):
    item(t01, "walls", "W02")["end"] = [11.885, 9.0]          # east wall stops short
    result, st = run(t01)
    assert "FAIL" in (st["Q05"], st["Q06"])
    assert not (result.out_dir / "model.glb").exists()        # nothing is exported


def test_missing_partition_merges_rooms(t01, run):
    t01["walls"] = [w for w in t01["walls"] if w["id"] != "W10"]
    result, st = run(t01)
    assert st["Q06"] == "FAIL" and "same enclosed region" in details(result, "Q06")


def test_opening_beyond_wall_end(t01, run):
    item(t01, "openings", "O13")["center"] = 4.6              # W09 is 4.885 m long
    result, st = run(t01)
    assert st["Q07"] == "FAIL" and "O13" in details(result, "Q07")


def test_opening_cutting_a_crossing_wall(t01, run):
    item(t01, "openings", "O11")["center"] = 3.285            # over the W06 junction
    result, st = run(t01)
    assert st["Q07"] == "FAIL" and "cuts into wall W06" in details(result, "Q07")


def test_overlapping_openings(t01, run):
    item(t01, "openings", "O02")["center"] = 5.0              # into the main door
    result, st = run(t01)
    assert st["Q07"] == "FAIL" and "overlap" in details(result, "Q07")


def test_window_above_ceiling(t01, run):
    item(t01, "openings", "O05")["sill"] = 2.0                # head at 3.2 m > 3.0 m
    result, st = run(t01)
    assert st["Q07"] == "FAIL" and "above ceiling" in details(result, "Q07")


def test_door_swing_into_unrelated_room(t01, run):
    item(t01, "openings", "O15")["opens_into"] = "R01"
    result, st = run(t01)
    assert st["Q07"] == "FAIL" and "O15" in details(result, "Q07")


def test_room_without_door_is_unreachable(t01, run):
    remove_opening(t01, "O15")                                # Bedroom 2's only door
    result, st = run(t01)
    assert st["Q09"] == "FAIL" and "R08" in details(result, "Q09")


def test_house_without_entrance(t01, run):
    remove_opening(t01, "O01")
    result, st = run(t01)
    assert st["Q09"] == "FAIL" and "no door to the exterior" in details(result, "Q09")


def test_habitable_room_without_window_warns(t01, run):
    remove_opening(t01, "O08")                                # Bedroom 2's window
    result, st = run(t01)
    assert st["Q10"] == "WARN" and "R08" in details(result, "Q10")


def test_seed_inside_wall(t01, run):
    item(t01, "rooms", "R01")["seed"] = [3.4, 2.0]           # on W06
    result, st = run(t01)
    assert st["Q06"] == "FAIL" and "inside a wall" in details(result, "Q06")


def test_dangling_reference(t01, run):
    item(t01, "openings", "O01")["wall"] = "W99"
    result, st = run(t01)
    assert st["Q02"] == "FAIL" and "W99" in details(result, "Q02")


def test_schema_rejects_element_without_provenance(t01, run):
    del item(t01, "walls", "W01")["prov"]
    result, st = run(t01)
    assert st["Q01"] == "FAIL" and not result.ok


def test_inferred_value_must_explain_itself(t01, run):
    del item(t01, "dimensions", "D-011")["note"]
    _, st = run(t01)
    assert st["Q01"] == "FAIL"


def test_level_without_walls_fails_without_crashing(t01, run):
    t01["levels"].append({**item(t01, "levels", "L00"), "id": "L01", "name": "First", "elevation": 3.15})
    result, st = run(t01)
    assert "L01: level has no walls" in details(result, "Q05") and not result.ok
