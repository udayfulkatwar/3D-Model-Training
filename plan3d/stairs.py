"""Stairs between stacked levels (T-014): straight flights and dog-legs.

A stair is given by the centre of its first riser (`start`), the direction it
climbs (N/E/S/W), its clear width, the number of risers and the going
(tread depth). A dog-leg climbs half its risers (rounded up), crosses a half
landing and climbs the rest back the other way, beside the first flight on
the side given by `turn`. The riser height follows from the two levels' floor heights,
so it cannot disagree with them. The top riser is the edge of the upper
floor slab: the opening (void) in that slab is the stair's footprint.
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
from shapely import unary_union
from shapely.geometry import LineString, Point, Polygon

from .model import Plan

DIRS = {"N": (0.0, 1.0), "E": (1.0, 0.0), "S": (0.0, -1.0), "W": (-1.0, 0.0)}
APPROACH = 0.3           # where a person stands before the first riser / after the top one
HEADROOM = 2.0           # clear height above every tread (Q22)
MAX_RISER, MIN_GOING = 0.19, 0.25                 # training thresholds, not a code check
BLONDEL = (0.55, 0.70)   # comfortable 2 x riser + going, metres
GUARD_HEIGHT = 0.9       # guard rail around stair openings (training value, not a code check)
GUARD_THICKNESS = 0.05


@dataclass
class Flight:
    foot: np.ndarray             # centre of its first riser
    u: np.ndarray                # unit climbing direction
    risers: int                  # including the riser at its top end
    first: int                   # risers climbed before this flight


@dataclass
class StairGeom:
    id: str
    level: str
    to_level: str
    foot: np.ndarray             # centre of the first riser, plan metres
    u: np.ndarray                # unit climbing direction of the first flight
    width: float
    risers: int
    going: float
    ffl: float                   # bottom floor level
    ffl_top: float               # top floor level
    kind: str = "straight"       # or "dogleg": two flights, half landing, second flight turned back
    side: float = 1.0            # dogleg: +1 second flight on the left of the first, -1 on the right
    landing: float = 0.0         # dogleg: half-landing depth
    gap: float = 0.0             # dogleg: well between the two flights

    @property
    def riser(self) -> float:
        return (self.ffl_top - self.ffl) / self.risers

    @property
    def across(self) -> np.ndarray:
        return np.array([-self.u[1], self.u[0]])

    @property
    def flights(self) -> list[Flight]:
        if self.kind == "straight":
            return [Flight(self.foot, self.u, self.risers, 0)]
        n1 = (self.risers + 1) // 2
        f1 = Flight(self.foot, self.u, n1, 0)
        foot2 = self.foot + self.u * self.going * (n1 - 1) + self.across * self.side * (self.width + self.gap)
        return [f1, Flight(foot2, -self.u, self.risers - n1, n1)]

    def flight_run(self, f: Flight) -> float:
        return self.going * (f.risers - 1)

    def flight_top(self, f: Flight) -> np.ndarray:
        return f.foot + f.u * self.flight_run(f)

    @property
    def run(self) -> float:
        """Horizontal length of the first flight (all of a straight stair)."""
        return self.flight_run(self.flights[0])

    @property
    def top(self) -> np.ndarray:
        """Centre of the top riser (the edge of the upper floor)."""
        return self.flight_top(self.flights[-1])

    @property
    def top_u(self) -> np.ndarray:
        """Direction of travel when stepping off the top riser."""
        return self.flights[-1].u

    def flight_rect(self, f: Flight) -> Polygon:
        a = np.array([-f.u[1], f.u[0]]) * self.width / 2
        t = self.flight_top(f)
        return Polygon([f.foot - a, f.foot + a, t + a, t - a])

    @property
    def landing_rect(self) -> Polygon | None:
        if self.kind == "straight":
            return None
        base = self.flight_top(self.flights[0])
        far = base + self.u * self.landing
        e1 = -self.across * self.side * self.width / 2
        e2 = self.across * self.side * (self.width * 1.5 + self.gap)
        return Polygon([base + e1, far + e1, far + e2, base + e2])

    @property
    def footprint(self) -> Polygon:
        """Plan area of the flights and landing; also the opening in the floor above."""
        shapes = [self.flight_rect(f) for f in self.flights]
        if self.landing_rect is not None:
            shapes.append(self.landing_rect)
        return unary_union(shapes) if len(shapes) > 1 else shapes[0]

    def tread_centres(self) -> list[np.ndarray]:
        """(x, y, z) at the middle of each tread's (and the landing's) top surface."""
        out = []
        for f in self.flights:
            out += [np.array([*(f.foot + f.u * self.going * (k + 0.5)), self.ffl + self.riser * (f.first + k + 1)])
                    for k in range(f.risers - 1)]
        if self.landing_rect is not None:
            c = self.landing_rect.centroid
            out.append(np.array([c.x, c.y, self.ffl + self.riser * self.flights[1].first]))
        return out


def build(plan: Plan) -> dict[str, StairGeom]:
    out = {}
    for s in plan.stairs.values():
        if s["level"] not in plan.levels or s["to_level"] not in plan.levels:
            continue                                    # reported by Q02
        out[s["id"]] = StairGeom(
            s["id"], s["level"], s["to_level"], np.asarray(s["start"], float), np.asarray(DIRS[s["direction"]]),
            s["width"], s["risers"], s["going"],
            plan.levels[s["level"]]["elevation"], plan.levels[s["to_level"]]["elevation"],
            s.get("type", "straight"), 1.0 if s.get("turn", "left") == "left" else -1.0,
            s.get("landing", s["width"]), s.get("gap", 0.0))
    return out


def _extrude_lane(sg: StairGeom, pts: list[tuple[float, float]], centre: np.ndarray, width: float) -> m3d.Manifold:
    """Extrude an (along u, up) profile across a lane of `width` centred on
    `centre` (the lane's point at along = 0), standing on the lower floor."""
    profile = m3d.CrossSection([np.asarray(pts)], m3d.FillRule.EvenOdd)
    lane = m3d.Manifold.extrude(profile, width)
    u, a = sg.u, sg.across
    origin = centre - a * width / 2
    # local (along, up, across) -> world
    return lane.transform(np.array([[u[0], 0.0, a[0], origin[0]],
                                    [u[1], 0.0, a[1], origin[1]],
                                    [0.0, 1.0, 0.0, sg.ffl]]))


def solids(sg: StairGeom) -> list[tuple[str, m3d.Manifold]]:
    """(name suffix, solid) per lane, each one stepped profile extruded
    across its lane and standing on the lower floor. Lanes touch but are
    never unioned: unions of solids with coincident faces leave slivers
    (L-026). A straight stair is one lane; a dog-leg is the first flight
    with its half of the landing, the second flight with the other half,
    and the landing over the well between them, if any."""
    G, R = sg.going, sg.riser
    f1 = sg.flights[0]
    run1 = sg.flight_run(f1)
    lane1 = [(0.0, 0.0)]
    for k in range(f1.risers - 1):
        lane1 += [(G * k, R * (k + 1)), (G * (k + 1), R * (k + 1))]
    if sg.kind == "straight":
        return [("", _extrude_lane(sg, lane1 + [(run1, 0.0)], sg.foot, sg.width))]
    f2 = sg.flights[1]
    z_land, far = R * f2.first, run1 + sg.landing
    lane1 += [(run1, z_land), (far, z_land), (far, 0.0)]
    # second flight, described in the first flight's along-axis: it climbs back from run1
    top = run1 - sg.flight_run(f2)
    lane2 = [(top, 0.0)]
    for k in reversed(range(f2.risers - 1)):
        z = R * (f2.first + k + 1)
        lane2 += [(run1 - G * (k + 1), z), (run1 - G * k, z)]
    lane2 += [(run1, z_land), (far, z_land), (far, 0.0)]
    side = sg.across * sg.side
    out = [("", _extrude_lane(sg, lane1, sg.foot, sg.width)),
           ("_F2", _extrude_lane(sg, lane2, sg.foot + side * (sg.width + sg.gap), sg.width))]
    if sg.gap > 0:
        well = [(run1, 0.0), (run1, z_land), (far, z_land), (far, 0.0)]
        out.append(("_WELL", _extrude_lane(sg, well, sg.foot + side * (sg.width + sg.gap) / 2, sg.gap)))
    return out


def room_at(lay, point) -> str | None:
    p = Point(point)
    return next((rid for rid, region in lay.room_regions.items() if region.contains(p)), None)


def linked_rooms(sg: StairGeom, layouts: dict) -> tuple[str | None, str | None]:
    """(room at the foot, room at the top landing)."""
    low, up = layouts.get(sg.level), layouts.get(sg.to_level)
    return (room_at(low, sg.foot - sg.u * APPROACH) if low else None,
            room_at(up, sg.top + sg.top_u * APPROACH) if up else None)


def landing_depth(sg: StairGeom, region) -> float:
    """Free floor beyond the top riser, in the climbing direction, up to the
    room boundary."""
    ray = LineString([sg.top, sg.top + sg.top_u * 20.0])
    inside = ray.intersection(region)
    parts = [g for g in getattr(inside, "geoms", [inside]) if g.length > 0]
    first = min(parts, key=lambda g: Point(sg.top).distance(g), default=None)
    return first.length if first is not None and Point(sg.top).distance(first) < 1e-6 else 0.0


def guard_region(sg: StairGeom, up_layout) -> Polygon:
    """Plan area of the guard rail around the stair's opening in the upper
    floor: a GUARD_THICKNESS band just outside every edge of the opening,
    except where a wall already closes it and across the top riser, where
    people step on and off."""
    band = sg.footprint.buffer(GUARD_THICKNESS, join_style="mitre").difference(sg.footprint)
    a = np.array([-sg.top_u[1], sg.top_u[0]]) * sg.width / 2
    t, out = sg.top, sg.top_u * (GUARD_THICKNESS * 2)
    arrival = Polygon([t - a, t + a, t + a + out, t - a + out])
    floor = unary_union(list(up_layout.room_regions.values()))
    return band.difference(arrival).difference(up_layout.footprint).intersection(floor)


def surface_z(sg: StairGeom, xy) -> float | None:
    """Height (absolute) of the stair's walking surface at a plan point, or
    None outside the stair."""
    p = Point(xy)
    for f in sg.flights:
        if sg.flight_rect(f).buffer(1e-9).contains(p):
            s = float(np.dot(np.asarray(xy) - f.foot, f.u))
            k = min(max(int(s // sg.going), 0), f.risers - 2)
            return sg.ffl + sg.riser * (f.first + k + 1)
    if sg.landing_rect is not None and sg.landing_rect.buffer(1e-9).contains(p):
        return sg.ffl + sg.riser * sg.flights[1].first
    return None


def balustrade_edges(sg: StairGeom, low_layout) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """(start, end, inward normal) of every stair edge with a drop beside it:
    outline edges that are not against a wall, not the foot of the first
    flight and not the top riser; and, on a dog-leg without a well, the side
    of the second flight above the first."""
    edges = []
    poly = sg.footprint.simplify(0)
    ring = [np.asarray(c) for c in poly.exterior.coords]
    entry = LineString([sg.foot - sg.across * sg.width / 2, sg.foot + sg.across * sg.width / 2])
    a = np.array([-sg.top_u[1], sg.top_u[0]]) * sg.width / 2
    arrival = LineString([sg.top - a, sg.top + a])
    for p, q in zip(ring, ring[1:]):
        m, d = (p + q) / 2, (q - p) / np.linalg.norm(q - p)
        n = np.array([-d[1], d[0]])
        if not poly.contains(Point(m + n * 0.01)):
            n = -n                                         # n points into the stair
        if entry.distance(Point(m)) < 1e-6 or arrival.distance(Point(m)) < 1e-6:
            continue
        samples = [p + (q - p) * t for t in (0.1, 0.5, 0.9)]
        if all(low_layout.footprint.buffer(1e-6).contains(Point(x - n * 0.05)) for x in samples):
            continue                                       # a wall closes this side
        edges.append((p, q, n))
    if sg.kind == "dogleg" and sg.gap == 0:
        f2 = sg.flights[1]
        n_in = sg.across * sg.side                     # from the first flight into the second
        edge = f2.foot - n_in * sg.width / 2
        edges.append((edge, edge + f2.u * sg.flight_run(f2), n_in))
    return edges


def balustrades(sg: StairGeom, low_layout) -> list[tuple[str, m3d.Manifold]]:
    """A GUARD_THICKNESS panel just inside each edge with a drop, standing on
    the treads (stepped bottom) and GUARD_HEIGHT above them along the pitch.
    One solid per edge (no unions, L-026); where two edges meet, the later
    one stops short of the corner so they do not overlap."""
    out, ends = [], []
    for i, (p, q, n) in enumerate(balustrade_edges(sg, low_layout)):
        length = float(np.linalg.norm(q - p))
        d = (q - p) / length
        t0 = GUARD_THICKNESS if any(np.allclose(p, e) for e in ends) else 0.0
        t1 = length - (GUARD_THICKNESS if any(np.allclose(q, e) for e in ends) else 0.0)
        ends += [p, q]
        cuts = {t0, t1}
        for f in sg.flights:
            for k in range(f.risers):
                cuts.add(float(np.dot(f.foot + f.u * sg.going * k - p, d)))
        cuts = sorted(t for t in cuts if t0 - 1e-9 <= t <= t1 + 1e-9)
        zs = [surface_z(sg, p + d * (a + b) / 2 + n * GUARD_THICKNESS / 2) for a, b in zip(cuts, cuts[1:])]
        if not zs or any(z is None for z in zs):
            continue
        z0 = sg.ffl
        bottom = [pt for (a, b), z in zip(zip(cuts, cuts[1:]), zs) for pt in ((a, z - z0), (b, z - z0))]
        top = [(t, max(zs[max(j - 1, 0)], zs[min(j, len(zs) - 1)]) - z0 + GUARD_HEIGHT)
               for j, t in enumerate(cuts)]
        profile = m3d.CrossSection([np.asarray(bottom + top[::-1])], m3d.FillRule.EvenOdd)
        panel = m3d.Manifold.extrude(profile, GUARD_THICKNESS)
        # local (along edge, up, inward) -> world
        out.append((f"_{i + 1}", panel.transform(np.array([[d[0], 0.0, n[0], p[0]],
                                                           [d[1], 0.0, n[1], p[1]],
                                                           [0.0, 1.0, 0.0, z0]]))))
    return out
