"""Walk tests (Q19): the probes must notice a blocked door or a missing wall."""

import numpy as np
import trimesh

from conftest import T01_PATH
from plan3d import plan2d, walktests
from plan3d.mesh3d import Part, build_parts
from plan3d.model import load_plan


def _t01():
    plan, errors = load_plan(T01_PATH)
    assert not errors
    layouts = {lid: plan2d.build_layout(plan, lid) for lid in sorted(plan.levels)}
    return plan, layouts, build_parts(plan, layouts)


def test_segment_hits_a_box_only_within_its_length():
    tris = trimesh.creation.box(extents=(1, 1, 1)).triangles
    hits = walktests.segment_hits(tris, np.array([-2.0, 0.1, 0.2]), np.array([2.0, 0.1, 0.2]))
    assert sorted(float(h) for h in np.round(hits, 3)) == [0.375, 0.625]
    assert len(walktests.segment_hits(tris, np.array([-2.0, 0.1, 0.2]), np.array([-1.0, 0.1, 0.2]))) == 0


def test_every_t01_probe_behaves_as_expected():
    plan, layouts, parts = _t01()
    results = walktests.run(walktests.generate(plan, layouts), parts)
    assert results and all(r["ok"] for r in results)
    kinds = {r["kind"] for r in results}
    assert {"door", "window", "wall"} <= kinds


def test_blocked_doorway_and_missing_wall_are_caught():
    plan, layouts, parts = _t01()
    tests = walktests.generate(plan, layouts)
    door = next(t for t in tests if t["kind"] == "door")
    wall = next(t for t in tests if t["kind"] == "wall")
    plug = trimesh.creation.box(extents=(0.2, 0.2, 0.2))
    plug.apply_translation(np.add(door["start"], door["end"]) / 2)
    hit_wall = walktests.first_hit(parts, wall["start"], wall["end"])
    damaged = [p for p in parts if p.name != hit_wall] + [Part("SM_Plug", "wall", "L00", plug)]
    bad = {r["name"] for r in walktests.run([door, wall], damaged) if not r["ok"]}
    assert bad == {door["name"], wall["name"]}
