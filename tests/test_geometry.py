"""Geometry-level behaviour: z-fighting detection, non-orthogonal walls, units."""

import math

import pytest
import shapely
import trimesh
from shapely.geometry import Polygon

from plan3d import qa
from plan3d.mesh3d import Part
from plan3d.units import SQFT_PER_SQM, sqm_to_sqft


def _part(name, extents, offset):
    box = trimesh.creation.box(extents=extents)
    box.apply_translation(offset)
    return Part(name, "wall", "L00", box)


def test_coplanar_same_facing_overlap_fails():
    # Two boxes whose top faces share the plane z = 1 and overlap: z-fighting.
    parts = [_part("A", (2, 2, 2), (0, 0, 0)), _part("B", (1, 1, 1), (0.5, 0.5, 0.5))]
    report = qa.Report()
    qa.check_coplanar(report, parts)
    assert report.get("Q13").status == "FAIL"


def test_back_to_back_contact_is_only_info():
    # Boxes touching face to face: hidden contact, expected in any assembly.
    parts = [_part("A", (1, 1, 1), (0, 0, 0)), _part("B", (1, 1, 1), (1, 0, 0))]
    report = qa.Report()
    qa.check_coplanar(report, parts)
    assert report.get("Q13").status == "INFO"


def test_degenerate_face_is_caught():
    m = trimesh.creation.box()
    sliver = trimesh.Trimesh([[0, 0, 0], [1, 0, 0], [2, 0, 0]], [[0, 1, 2]], process=False)
    report = qa.Report()
    qa.check_degenerate(report, [Part("S", "wall", "L00", trimesh.util.concatenate([m, sliver]))])
    assert report.get("Q12").status == "FAIL"


def _polygon_room(pts, window_wall=None):
    """Single room whose wall centre-lines follow the closed polygon pts."""
    n = len(pts)
    walls = [{"id": f"W{i}", "level": "L00", "type": "EXT", "start": list(pts[i]),
              "end": list(pts[(i + 1) % n]), "prov": ["D-1"]} for i in range(n)]
    def length(i):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        return ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    openings = [{"id": "D", "wall": "W0", "kind": "door", "center": length(0) / 2, "width": 0.9,
                 "height": 2.1, "sill": 0, "prov": ["D-1"]}]
    if window_wall is not None:
        openings.append({"id": "G", "wall": f"W{window_wall}", "kind": "window",
                         "center": length(window_wall) / 2, "width": 0.6, "height": 1.2,
                         "sill": 0.9, "prov": ["D-1"]})
    centre = Polygon(pts)
    seed = centre.representative_point()
    return {
        "schema_version": "0.1",
        "project": {"id": "P", "name": "Polygon test", "nature": "unit test", "owner": "tests",
                    "permission": "test", "units": "m", "datum": "centre-line origin"},
        "tolerances": {"length": 0.001, "area_rel": 0.001},
        "sources": [{"id": "S", "title": "test", "revision": "A", "date": "2026-10-19", "kind": "other"}],
        "dimensions": [{"id": "D-1", "label": "all", "value": 0.2, "status": "CONFIRMED", "source": "S",
                        "check": {"kind": "param", "targets": ["wall_types.EXT.thickness"]}}],
        "levels": [{"id": "L00", "name": "G", "elevation": 0, "wall_height": 3, "floor_thickness": 0.1,
                    "roof_thickness": 0.1, "prov": ["D-1"]}],
        "wall_types": [{"id": "EXT", "thickness": 0.2, "prov": ["D-1"]}],
        "walls": walls,
        "openings": openings,
        "rooms": [{"id": "R", "name": "Room", "level": "L00", "use": "living",
                   "seed": [seed.x, seed.y], "prov": ["D-1"]}],
    }, centre


HEX = [(3 + 3 * math.cos(a), 3 + 3 * math.sin(a))
       for a in [i * math.pi / 3 for i in range(6)]]


@pytest.mark.parametrize("name,pts,window_wall", [
    ("triangle, 60 deg", [(0, 0), (6, 0), (3, 3 * 3 ** 0.5)], 1),
    ("chamfer, 90/135 deg", [(0, 0), (6, 0), (6, 3), (5, 4), (0, 4)], 2),
    ("hexagon, 120 deg", HEX, 3),
    ("L-shape, reflex corner", [(0, 0), (6, 0), (6, 3), (3, 3), (3, 6), (0, 6)], 4),
])
def test_wall_joints_are_exact_at_any_angle(run, name, pts, window_wall):
    """The clear room must equal the centre-line polygon offset inward by half
    the wall, and the outline must equal it offset outward (mitred)."""
    from plan3d.model import load_plan
    from plan3d.plan2d import build_layout

    raw, centre = _polygon_room(pts, window_wall)
    result, st = run(raw)
    assert result.ok, [c.details for c in result.report.checks if c.status == "FAIL"]
    plan, _ = load_plan(result.out_dir.parent / "plan.json")
    lay = build_layout(plan, "L00")
    room_err = lay.room_regions["R"].symmetric_difference(centre.buffer(-0.1, join_style="mitre")).area
    outer_err = shapely.Polygon(lay.footprint.exterior).symmetric_difference(
        centre.buffer(0.1, join_style="mitre", mitre_limit=10)).area
    # area error / perimeter = mean edge offset; must be under 0.01 mm
    assert room_err / centre.length < 1e-5 and outer_err / centre.length < 1e-5, \
        (name, room_err, outer_err)


def test_thick_wall_at_shallow_tee_is_flagged(run):
    """A 400 mm wall ending at 30 degrees on a 200 mm wall pokes through it."""
    raw, _ = _polygon_room([(0, 0), (6, 0), (6, 4), (0, 4)])
    raw["dimensions"].append({"id": "D-2", "label": "thick", "value": 0.4, "status": "CONFIRMED",
                              "source": "S",
                              "check": {"kind": "param", "targets": ["wall_types.THK.thickness"]}})
    raw["wall_types"].append({"id": "THK", "thickness": 0.4, "prov": ["D-2"]})
    raw["walls"].append({"id": "WX", "level": "L00", "type": "THK", "start": [1.0, 4.0],
                         "end": [1.0 + 1.5 * 3 ** 0.5, 2.5], "prov": ["D-2"]})
    result, st = run(raw)
    assert st["Q04"] == "WARN" and "pokes through" in "\n".join(result.report.get("Q04").details)


def test_square_foot_conversion_is_exact():
    assert SQFT_PER_SQM == pytest.approx(10.763910416709722, rel=1e-15)
    assert sqm_to_sqft(120.0) == pytest.approx(1291.669, abs=1e-3)   # T01 / H01 envelope
