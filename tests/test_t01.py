"""The T01 training plan builds cleanly and its numbers agree with
independent hand arithmetic (not with the code under test)."""

import csv
import hashlib
import json

import numpy as np
import pytest
import trimesh

from conftest import item

EXT, INT = 0.115, 0.0575     # half wall thicknesses, metres

# Clear room sizes from centre-lines minus half wall thicknesses, by hand.
HAND = {
    "R01": ((8.4 - INT) - (3.4 + INT), (5.0 - INT) - (0.115 + EXT)),
    "R02": ((3.4 - INT) - (0.115 + EXT), (5.0 - INT) - (0.115 + EXT)),
    "R03": ((11.885 - EXT) - (8.4 + INT), (5.0 - INT) - (0.115 + EXT)),
    "R04": ((4.6 - INT) - (0.115 + EXT), (9.885 - EXT) - (5.0 + INT)),
    "R05": ((6.4 - INT) - (4.6 + INT), (9.885 - EXT) - (7.4 + INT)),
    "R06": ((6.4 - INT) - (4.6 + INT), (7.4 - INT) - (5.0 + INT)),
    "R07": ((8.9 - INT) - (6.4 + INT), (9.885 - EXT) - (5.0 + INT)),
    "R08": ((11.885 - EXT) - (8.9 + INT), (9.885 - EXT) - (5.0 + INT)),
}


def test_t01_builds_without_failures(t01, run):
    result, st = run(t01)
    assert result.ok, st
    assert all(st[f"Q{n:02d}"] in ("PASS", "INFO") for n in (1, 2, 4, 5, 6, 7, 9, 11, 12, 14, 15, 16))
    assert st["Q13"] in ("PASS", "INFO")          # touching solids only, no z-fighting
    # The only warnings are the ones designed into the training plan:
    warns = [d for c in result.report.checks for d in c.details if d.startswith("[WARN]")]
    assert len(warns) == 3, warns
    assert sum("OPEN" in w for w in warns) == 2
    assert any("R06" in w and "ventilation" in w for w in warns)


def test_room_areas_match_hand_arithmetic(t01, run):
    result, _ = run(t01)
    rows = {r["RoomID"]: r for r in csv.DictReader(open(result.out_dir / "rooms.csv"))}
    assert set(rows) == set(HAND)
    for rid, (x, y) in HAND.items():
        assert float(rows[rid]["ClearX_m"]) == pytest.approx(x, abs=1e-4)
        assert float(rows[rid]["ClearY_m"]) == pytest.approx(y, abs=1e-4)
        assert float(rows[rid]["Area_m2"]) == pytest.approx(x * y, abs=1e-3)


def test_wall_volume_matches_analytic_value(t01, run):
    """walls = (built-up - carpet) x full height - sum of opening voids."""
    result, _ = run(t01)
    lv = item(t01, "levels", "L00")
    full_h = lv["floor_thickness"] + lv["wall_height"] + lv["roof_thickness"]
    carpet = sum(x * y for x, y in HAND.values())
    thick = {w["id"]: (0.23 if w["type"] == "EXT" else 0.115) for w in t01["walls"]}
    voids = sum(o["width"] * o["height"] * thick[o["wall"]] for o in t01["openings"])
    expected = (12.0 * 10.0 - carpet) * full_h - voids
    manifest = json.loads((result.out_dir / "manifest.json").read_text())
    built = next(m for m in manifest["meshes"] if m["name"] == "L00_WALLS")["volume_m3"]
    assert built == pytest.approx(expected, abs=1e-6)          # exact (float64) solid
    glb = trimesh.load(result.out_dir / "model.glb", force="scene").geometry["L00_WALLS"]
    # glTF stores positions as float32 (~1 micron here), so the GLB is looser
    assert glb.volume == pytest.approx(expected, abs=1e-4)


def test_glb_axes_follow_gltf_convention(t01, run):
    result, _ = run(t01)
    scene = trimesh.load(result.out_dir / "model.glb", force="scene")
    lo, hi = scene.geometry["L00_WALLS"].bounds
    assert np.allclose(lo, [0.0, -0.15, -10.0], atol=1e-6)    # north (+Y plan) -> -Z
    assert np.allclose(hi, [12.0, 3.15, 0.0], atol=1e-6)      # up -> +Y


def test_every_part_is_named_and_present(t01, run):
    result, _ = run(t01)
    names = set(trimesh.load(result.out_dir / "model.glb", force="scene").geometry)
    rooms = [r["id"] for r in t01["rooms"]]
    windows = [o["id"] for o in t01["openings"] if o["kind"] == "window"]
    doors = [o["id"] for o in t01["openings"] if o["kind"] == "door"]
    expected = {"L00_WALLS"} | {f"L00_{k}_{r}" for r in rooms for k in ("FLOOR", "CEILING")} \
        | {f"L00_GLASS_{w}" for w in windows} | {f"L00_FRAME_{o}" for o in windows + doors} \
        | {f"L00_DOOR_{d}" for d in doors}
    assert names == expected                      # arches get no frame or leaf


def test_build_is_deterministic(t01, run):
    a, _ = run(t01)
    b, _ = run(t01)
    digest = [hashlib.sha256((r.out_dir / "model.glb").read_bytes()).hexdigest() for r in (a, b)]
    assert digest[0] == digest[1]
