"""2D layout: wall footprints, enclosed rooms, openings and circulation.

Rooms are not drawn as polygons in plan.json. A room is the region enclosed
by wall faces that contains the room's seed point, so room shapes and areas
always follow from the walls (lesson L-006: areas come from geometry).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from .model import Plan

GRID = 1e-6          # coordinate precision for 2D booleans, metres
COLLINEAR_TOL = 1e-5 # 0.01 mm
CUT_MARGIN = 0.01    # openings are cut this much beyond each wall face
SLIVER_AREA = 0.01   # enclosed regions smaller than this (m^2) are reported
EXTERIOR = "EXTERIOR"


@dataclass
class WallGeom:
    id: str
    start: np.ndarray
    end: np.ndarray
    thickness: float
    length: float
    direction: np.ndarray        # unit vector start -> end
    normal: np.ndarray           # unit vector, direction rotated +90 degrees
    poly: Polygon                # footprint, extended at joints

    def point_at(self, s: float) -> np.ndarray:
        return self.start + self.direction * s

    def strip(self, a: float, b: float, half_width: float) -> Polygon:
        return LineString([self.point_at(a), self.point_at(b)]).buffer(
            half_width, cap_style="flat", join_style="mitre")


@dataclass
class OpeningGeom:
    id: str
    wall_id: str
    kind: str
    a: float                     # along-wall start of opening
    b: float                     # along-wall end of opening
    sill: float
    head: float
    center: np.ndarray
    rect: Polygon                # exact wall-thickness footprint
    cut_rect: Polygon            # rect widened by CUT_MARGIN each side
    sides: tuple[str, str] = ("", "")   # room id or EXTERIOR on each side
    opens_into: str | None = None
    hinge_at_start: bool = True


@dataclass
class LevelLayout:
    level_id: str
    walls: dict[str, WallGeom]
    footprint: Polygon | shapely.MultiPolygon
    outline: Polygon | None
    regions: list[Polygon]
    room_regions: dict[str, Polygon] = field(default_factory=dict)
    unassigned: list[Polygon] = field(default_factory=list)
    openings: dict[str, OpeningGeom] = field(default_factory=dict)
    issues: list[tuple[str, str, str]] = field(default_factory=list)  # (check, status, message)

    def region_id_at(self, pt) -> str | None:
        p = Point(pt)
        for rid, poly in self.room_regions.items():
            if poly.contains(p):
                return rid
        if self.outline is None or not self.outline.contains(p):
            return EXTERIOR
        return None


def _clean(geom):
    # Snap to the grid, then drop vertices within COLLINEAR_TOL of a straight
    # line: grid-snapped irrational coordinates otherwise leave near-collinear
    # points that triangulate into slivers (lesson L-004).
    geom = shapely.set_precision(geom, GRID)
    return shapely.simplify(geom, COLLINEAR_TOL, preserve_topology=True)


def _wall_geoms(plan: Plan, level_id: str) -> dict[str, WallGeom]:
    out = {}
    for w in plan.walls.values():
        if w["level"] != level_id:
            continue
        s, e = np.asarray(w["start"], float), np.asarray(w["end"], float)
        length = float(np.linalg.norm(e - s))
        if length == 0:
            continue
        d = (e - s) / length
        t = plan.wall_types[w["type"]]["thickness"]
        poly = LineString([s, e]).buffer(t / 2, cap_style="flat", join_style="mitre")
        out[w["id"]] = WallGeom(w["id"], s, e, t, length, d, np.array([-d[1], d[0]]), poly)
    return out


def _intersect(p1, d1, p2, d2):
    det = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(det) < 1e-9:
        return None                       # parallel faces (straight continuation)
    s = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / det
    return p1 + d1 * s


def _joint_fills(walls: dict[str, WallGeom]) -> list[Polygon]:
    """Mitred fill where two or more wall *ends* meet at one node.

    Walls are flat-capped at their centre-line ends. Around each node the
    ends are sorted by angle; each pair of neighbouring faces is intersected
    to find its mitre point. The convex hull of the node, the cap corners and
    the mitre points closes the joint exactly at any angle.
    """
    nodes: dict[tuple, list] = {}
    for wg in walls.values():
        for pt, away in ((wg.start, wg.direction), (wg.end, -wg.direction)):
            nodes.setdefault((round(pt[0], 6), round(pt[1], 6)), []).append((wg, away))
    fills = []
    for key, ends in nodes.items():
        if len(ends) < 2:
            continue
        node = np.array(key)
        ends.sort(key=lambda e: np.arctan2(e[1][1], e[1][0]))
        pts = [node]
        for wg, d in ends:
            n = np.array([-d[1], d[0]]) * wg.thickness / 2
            pts += [node + n, node - n]
        for (wa, da), (wb, db) in zip(ends, ends[1:] + ends[:1], strict=True):
            left_a = np.array([-da[1], da[0]]) * wa.thickness / 2    # a's face toward b
            right_b = np.array([db[1], -db[0]]) * wb.thickness / 2   # b's face toward a
            p = _intersect(node + left_a, da, node + right_b, db)
            if p is not None:
                pts.append(p)
        fills.append(shapely.MultiPoint(pts).convex_hull)
    return fills


def _tee_issues(walls: dict[str, WallGeom]) -> list[tuple[str, str, str]]:
    """A wall ending on another wall's face-line must not poke through it."""
    issues = []
    for stem in walls.values():
        for pt in (stem.start, stem.end):
            for host in walls.values():
                if host.id == stem.id:
                    continue
                on_line = LineString([host.start, host.end]).distance(Point(pt)) < 1e-6
                at_end = min(np.linalg.norm(pt - host.start), np.linalg.norm(pt - host.end)) < 1e-6
                if on_line and not at_end:
                    poke = stem.thickness / 2 * abs(float(stem.direction @ host.direction))
                    if poke > host.thickness / 2 + 1e-9:
                        issues.append(("walls", "WARN", f"wall {stem.id} meets {host.id} at a shallow "
                                       "angle; its end pokes through the far face"))
    return issues


def build_layout(plan: Plan, level_id: str) -> LevelLayout:
    walls = _wall_geoms(plan, level_id)
    footprint = _clean(unary_union([wg.poly for wg in walls.values()] + _joint_fills(walls)))
    issues: list[tuple[str, str, str]] = _tee_issues(walls)

    outline = None
    regions: list[Polygon] = []
    if footprint.is_empty:
        issues.append(("envelope", "FAIL", "level has no walls"))
    elif isinstance(footprint, Polygon):
        outline = Polygon(footprint.exterior)
        interior = _clean(outline.difference(footprint))
        parts = list(getattr(interior, "geoms", [interior]))
        for poly in parts:
            if poly.is_empty:
                continue
            if poly.area < SLIVER_AREA:
                issues.append(("rooms", "WARN", f"sliver region of {poly.area:.4f} m^2 at "
                               f"{tuple(round(c, 3) for c in poly.centroid.coords[0])}"))
                continue
            regions.append(poly)
    else:
        issues.append(("envelope", "FAIL", f"walls form {len(footprint.geoms)} disconnected groups"))

    layout = LevelLayout(level_id, walls, footprint, outline, regions, issues=issues)
    _assign_rooms(plan, layout)
    _place_openings(plan, layout)
    return layout


def _assign_rooms(plan: Plan, layout: LevelLayout) -> None:
    owners: dict[int, list[str]] = {}
    for room in plan.rooms.values():
        if room["level"] != layout.level_id:
            continue
        seed = Point(room["seed"])
        hits = [i for i, r in enumerate(layout.regions) if r.contains(seed)]
        if len(hits) != 1:
            where = "inside a wall" if layout.footprint.contains(seed) else "not in any enclosed region"
            layout.issues.append(("rooms", "FAIL", f"room {room['id']} ({room['name']}): seed is {where}"))
            continue
        owners.setdefault(hits[0], []).append(room["id"])
    for i, region in enumerate(layout.regions):
        ids = owners.get(i, [])
        if len(ids) > 1:
            layout.issues.append(("rooms", "FAIL", f"rooms {', '.join(ids)} resolve to the same "
                                  "enclosed region (missing wall?)"))
        if ids:
            layout.room_regions[ids[0]] = region
        else:
            layout.unassigned.append(region)
            c = region.representative_point()
            layout.issues.append(("rooms", "WARN", f"enclosed region of {region.area:.2f} m^2 near "
                                  f"({c.x:.2f}, {c.y:.2f}) has no room"))


def _place_openings(plan: Plan, layout: LevelLayout) -> None:
    for op in plan.openings.values():
        wg = layout.walls.get(op["wall"])
        if wg is None:
            continue
        a, b = op["center"] - op["width"] / 2, op["center"] + op["width"] / 2
        rect = wg.strip(a, b, wg.thickness / 2)
        cut = wg.strip(a, b, wg.thickness / 2 + CUT_MARGIN)
        center = wg.point_at(op["center"])
        probe = wg.thickness / 2 + 0.05
        sides = tuple(layout.region_id_at(center + sgn * wg.normal * probe) or "UNASSIGNED"
                      for sgn in (1, -1))
        layout.openings[op["id"]] = OpeningGeom(
            op["id"], wg.id, op["kind"], a, b, op["sill"], op["sill"] + op["height"],
            center, rect, cut, sides, op.get("opens_into"), op.get("hinge", "start") == "start")


def door_side(og: OpeningGeom) -> int:
    """+1 if the door swings to its wall's +normal side, else -1."""
    target = og.opens_into or next((s for s in og.sides if s != EXTERIOR), og.sides[0])
    return 1 if og.sides[0] == target else -1


def door_hinge(layout: LevelLayout, og: OpeningGeom, inset: float = 0.0):
    """(hinge point on the swing-side wall face, unit vector from hinge across the opening)."""
    wg = layout.walls[og.wall_id]
    s = og.a + inset if og.hinge_at_start else og.b - inset
    u = wg.direction if og.hinge_at_start else -wg.direction
    return wg.point_at(s) + wg.normal * door_side(og) * wg.thickness / 2, u


def door_sweep(layout: LevelLayout, og: OpeningGeom, steps: int = 24) -> Polygon:
    """Quarter-disc swept by the leaf when it opens 90 degrees."""
    wg = layout.walls[og.wall_id]
    h, u = door_hinge(layout, og)
    n = wg.normal * door_side(og)
    r = og.b - og.a
    arc = [h + r * (np.cos(t) * u + np.sin(t) * n) for t in np.linspace(0, np.pi / 2, steps)]
    return Polygon([h, *arc])


def opening_conflicts(layout: LevelLayout) -> list[str]:
    """Openings that leave their wall, cut into another wall, or overlap."""
    problems = []
    by_wall: dict[str, list[OpeningGeom]] = {}
    for og in layout.openings.values():
        wg = layout.walls[og.wall_id]
        if og.a < -1e-9 or og.b > wg.length + 1e-9:
            problems.append(f"{og.id}: spans {og.a:.3f}..{og.b:.3f} m but wall {wg.id} "
                            f"centre-line is {wg.length:.3f} m long")
        for other in layout.walls.values():
            if other.id != wg.id and og.cut_rect.intersection(other.poly).area > 1e-8:
                problems.append(f"{og.id}: cuts into wall {other.id}")
        by_wall.setdefault(og.wall_id, []).append(og)
    for wall_id, ops in by_wall.items():
        ops.sort(key=lambda o: o.a)
        for p, q in zip(ops, ops[1:], strict=False):
            if q.a < p.b - 1e-9:
                problems.append(f"{p.id} and {q.id} overlap on wall {wall_id}")
    return problems


def circulation(layout: LevelLayout) -> dict[str, set[str]]:
    """Room adjacency graph through doors and arches (windows excluded)."""
    graph: dict[str, set[str]] = {rid: set() for rid in layout.room_regions}
    graph.setdefault(EXTERIOR, set())
    for og in layout.openings.values():
        if og.kind == "window":
            continue
        u, v = og.sides
        graph.setdefault(u, set()).add(v)
        graph.setdefault(v, set()).add(u)
    return graph


def reachable_from_exterior(graph: dict[str, set[str]]) -> set[str]:
    seen, stack = {EXTERIOR}, [EXTERIOR]
    while stack:
        for nxt in graph.get(stack.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def measure(layout_by_level: dict[str, LevelLayout], plan: Plan, check: dict) -> float | None:
    """Measured value for a geometric dimension check, or None if unmeasurable."""
    kind = check["kind"]
    if kind == "overall":
        lay = layout_by_level.get(check["level"])
        if lay is None:
            return None
        minx, miny, maxx, maxy = lay.footprint.bounds
        return maxx - minx if check["axis"] == "x" else maxy - miny
    room = plan.rooms.get(check["room"])
    if room is None:
        return None
    region = layout_by_level[room["level"]].room_regions.get(room["id"])
    if region is None:
        return None
    if kind == "room_area":
        return region.area
    minx, miny, maxx, maxy = region.bounds
    return maxx - minx if check["axis"] == "x" else maxy - miny
