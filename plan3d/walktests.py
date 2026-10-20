"""Walk tests: straight probe lines a person would take, with the expected
outcome. Through every door and arch the line must pass freely; at every
window and solid stretch of wall it must be blocked.

The same probes run twice: here against the built meshes (Q19), and in
Unreal against its collision (unreal/walk_test.py), so a mismatch in Unreal
points at the import, not at the tests.
"""

from __future__ import annotations

import numpy as np

from .mesh3d import Part
from .model import Plan

PROBE_M = 0.4            # how far into each room a probe starts and ends
DOOR_PROBE_Z = 1.0       # chest height above finished floor
WALL_PROBE_Z = 1.5
WALL_END_CLEAR = 0.3     # stay away from junctions
OPENING_CLEAR = 0.15     # and from opening reveals


def generate(plan: Plan, layouts: dict) -> list[dict]:
    tests = []
    for lid, lay in layouts.items():
        ffl = plan.levels[lid]["elevation"]
        for og in sorted(lay.openings.values(), key=lambda o: o.id):
            wg = lay.walls[og.wall_id]
            reach = wg.thickness / 2 + PROBE_M
            z = ffl + (DOOR_PROBE_Z if og.kind != "window" else (og.sill + og.head) / 2)
            tests.append({"name": f"{og.kind}:{og.id}", "kind": og.kind,
                          "start": [*(og.center + wg.normal * reach), z],
                          "end": [*(og.center - wg.normal * reach), z],
                          "expect_hit": og.kind == "window"})
        for wg in sorted(lay.walls.values(), key=lambda w: w.id):
            free = [(WALL_END_CLEAR, wg.length - WALL_END_CLEAR)]
            for og in lay.openings.values():
                if og.wall_id != wg.id:
                    continue
                lo, hi = og.a - OPENING_CLEAR, og.b + OPENING_CLEAR
                free = [seg for a, b in free for seg in ((a, min(b, lo)), (max(a, hi), b)) if seg[1] - seg[0] > 0]
            a, b = max(free, key=lambda s: s[1] - s[0], default=(0, 0))
            if b - a < 0.2:
                continue
            c = wg.point_at((a + b) / 2)
            reach = wg.thickness / 2 + PROBE_M
            tests.append({"name": f"wall:{wg.id}", "kind": "wall",
                          "start": [*(c + wg.normal * reach), ffl + WALL_PROBE_Z],
                          "end": [*(c - wg.normal * reach), ffl + WALL_PROBE_Z],
                          "expect_hit": True})
    return [{**t, "start": [round(float(v), 4) for v in t["start"]],
             "end": [round(float(v), 4) for v in t["end"]]} for t in tests]


def segment_hits(tris: np.ndarray, s: np.ndarray, e: np.ndarray) -> np.ndarray:
    """Fractions t in [0, 1] along s->e where the segment crosses any of the
    triangles (n, 3, 3). Moller-Trumbore, vectorised; no spatial index needed."""
    d = e - s
    v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    p = np.cross(d, e2)
    det = np.einsum("ij,ij->i", e1, p)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    tv = s - v0
    u = np.einsum("ij,ij->i", tv, p) * inv
    q = np.cross(tv, e1)
    v = (q @ d) * inv
    t = np.einsum("ij,ij->i", e2, q) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t >= 0) & (t <= 1)
    return t[hit]


def first_hit(parts: list[Part], start, end) -> str | None:
    """Name of the first part the segment start->end touches, or None."""
    s, e = np.asarray(start, float), np.asarray(end, float)
    best = (None, np.inf)
    for p in parts:
        t = segment_hits(np.asarray(p.solid.triangles, float), s, e)
        if len(t) and t.min() < best[1]:
            best = (p.name, float(t.min()))
    return best[0]


def run(tests: list[dict], parts: list[Part]) -> list[dict]:
    out = []
    for t in tests:
        hit = first_hit(parts, t["start"], t["end"])
        out.append({**t, "hit": hit, "ok": (hit is not None) == t["expect_hit"]})
    return out
