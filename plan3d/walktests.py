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
CLEAR_HEIGHTS = (0.75, 1.0, 1.25)   # above floor, where shoulders and hips pass
CLEAR_DEPTHS = 21
WALKER_WIDTH = 0.5       # shoulder width of a walkthrough body (Q20 warns below this)
DEFAULT_PAWN_WIDTH = 0.7  # Unreal DefaultPawn sphere (radius 35 cm), used in Play mode of a blank project


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


def _crossings(tris: np.ndarray, s: np.ndarray, e: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(mask, t): which of the triangles (n, 3, 3) the segment s->e crosses,
    and at what fraction t along it. Moller-Trumbore, vectorised."""
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
    return ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t >= 0) & (t <= 1), t


def segment_hits(tris: np.ndarray, s: np.ndarray, e: np.ndarray) -> np.ndarray:
    """Fractions t in [0, 1] along s->e where the segment crosses any of the
    triangles (n, 3, 3); no spatial index needed."""
    hit, t = _crossings(tris, s, e)
    return t[hit]


class Scene:
    """All parts' triangles in one array, so each probe is one numpy call."""

    def __init__(self, parts: list[Part]):
        self.names = [p.name for p in parts]
        tris = [np.asarray(p.solid.triangles, float) for p in parts]
        self.tris = np.concatenate(tris)
        self.owner = np.repeat(np.arange(len(parts)), [len(t) for t in tris])

    def first_hit_at(self, start, end) -> tuple[str | None, float]:
        """(name, fraction along start->end) of the first part the segment
        touches, or (None, 1.0)."""
        hit, t = _crossings(self.tris, np.asarray(start, float), np.asarray(end, float))
        if not hit.any():
            return None, 1.0
        i = np.flatnonzero(hit)[np.argmin(t[hit])]
        return self.names[self.owner[i]], float(t[i])


def first_hit(parts: list[Part], start, end) -> str | None:
    """Name of the first part the segment start->end touches, or None."""
    return Scene(parts).first_hit_at(start, end)[0]


def clearances(plan: Plan, layouts: dict, parts: list[Part]) -> list[dict]:
    """Clear walking width of every door and arch: the free gap along the wall
    left by frames, the open leaf and reveals, measured by lines along the wall
    at several depths and heights. Also returns a probe through the middle of
    that gap, for a sphere sweep in Unreal."""
    scene = Scene(parts)
    out = []
    for lid, lay in layouts.items():
        ffl = plan.levels[lid]["elevation"]
        for og in sorted(lay.openings.values(), key=lambda o: o.id):
            if og.kind == "window":
                continue
            wg = lay.walls[og.wall_id]
            search = (og.b - og.a) / 2 + 0.3
            reach = wg.thickness / 2 + PROBE_M + search      # covers a sweep sphere's ends too
            lo, hi = -search, search
            for z in CLEAR_HEIGHTS:
                for d in np.linspace(-reach, reach, CLEAR_DEPTHS):
                    c = np.array([*(og.center + wg.normal * d), ffl + z])
                    along = np.array([*wg.direction, 0.0]) * search
                    hit_r, tr = scene.first_hit_at(c, c + along)
                    hit_l, tl = scene.first_hit_at(c, c - along)
                    if hit_r is not None:
                        hi = min(hi, tr * search)
                    if hit_l is not None:
                        lo = max(lo, -tl * search)
            mid = og.center + wg.direction * (lo + hi) / 2
            r = wg.thickness / 2 + PROBE_M
            z = ffl + DOOR_PROBE_Z
            out.append({"name": f"{og.kind}:{og.id}", "kind": og.kind,
                        "clear_m": round(float(hi - lo), 4),
                        "start": [round(float(v), 4) for v in (*(mid + wg.normal * r), z)],
                        "end": [round(float(v), 4) for v in (*(mid - wg.normal * r), z)]})
    return out


def run(tests: list[dict], parts: list[Part]) -> list[dict]:
    scene = Scene(parts)
    out = []
    for t in tests:
        hit = scene.first_hit_at(t["start"], t["end"])[0]
        out.append({**t, "hit": hit, "ok": (hit is not None) == t["expect_hit"]})
    return out
