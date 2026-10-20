"""Straight stair flights between stacked levels (T-014).

A stair is given by the centre of its first riser (`start`), the direction it
climbs (N/E/S/W), its clear width, the number of risers and the going
(tread depth). The riser height follows from the two levels' floor heights,
so it cannot disagree with them. The top riser is the edge of the upper
floor slab: the opening (void) in that slab is the stair's footprint.
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
from shapely.geometry import LineString, Point, Polygon

from .model import Plan

DIRS = {"N": (0.0, 1.0), "E": (1.0, 0.0), "S": (0.0, -1.0), "W": (-1.0, 0.0)}
APPROACH = 0.3           # where a person stands before the first riser / after the top one
HEADROOM = 2.0           # clear height above every tread (Q22)
MAX_RISER, MIN_GOING = 0.19, 0.25                 # training thresholds, not a code check
BLONDEL = (0.55, 0.70)   # comfortable 2 x riser + going, metres


@dataclass
class StairGeom:
    id: str
    level: str
    to_level: str
    foot: np.ndarray             # centre of the first riser, plan metres
    u: np.ndarray                # unit climbing direction
    width: float
    risers: int
    going: float
    ffl: float                   # bottom floor level
    ffl_top: float               # top floor level

    @property
    def riser(self) -> float:
        return (self.ffl_top - self.ffl) / self.risers

    @property
    def run(self) -> float:
        """Horizontal length from first riser to the top riser (slab edge)."""
        return self.going * (self.risers - 1)

    @property
    def across(self) -> np.ndarray:
        return np.array([-self.u[1], self.u[0]])

    @property
    def top(self) -> np.ndarray:
        return self.foot + self.u * self.run

    @property
    def footprint(self) -> Polygon:
        a = self.across * self.width / 2
        return Polygon([self.foot - a, self.foot + a, self.top + a, self.top - a])

    def tread_centres(self) -> list[np.ndarray]:
        """(x, y, z) at the middle of each tread's top surface."""
        return [np.array([*(self.foot + self.u * self.going * (k + 0.5)), self.ffl + self.riser * (k + 1)])
                for k in range(self.risers - 1)]


def build(plan: Plan) -> dict[str, StairGeom]:
    out = {}
    for s in plan.stairs.values():
        if s["level"] not in plan.levels or s["to_level"] not in plan.levels:
            continue                                    # reported by Q02
        out[s["id"]] = StairGeom(
            s["id"], s["level"], s["to_level"], np.asarray(s["start"], float), np.asarray(DIRS[s["direction"]]),
            s["width"], s["risers"], s["going"],
            plan.levels[s["level"]]["elevation"], plan.levels[s["to_level"]]["elevation"])
    return out


def solid(sg: StairGeom) -> m3d.Manifold:
    """Solid flight standing on the lower floor: one stepped profile extruded
    across the width (unioned boxes would leave slivers, L-026)."""
    pts = [(0.0, 0.0)]
    for k in range(sg.risers - 1):
        z = sg.riser * (k + 1)
        pts += [(sg.going * k, z), (sg.going * (k + 1), z)]
    pts.append((sg.run, 0.0))
    profile = m3d.CrossSection([np.asarray(pts)], m3d.FillRule.EvenOdd)
    flight = m3d.Manifold.extrude(profile, sg.width)
    # local (along, up, across) -> world
    u, a = sg.u, sg.across
    origin = sg.foot - a * sg.width / 2
    return flight.transform(np.array([[u[0], 0.0, a[0], origin[0]],
                                      [u[1], 0.0, a[1], origin[1]],
                                      [0.0, 1.0, 0.0, sg.ffl]]))


def room_at(lay, point) -> str | None:
    p = Point(point)
    return next((rid for rid, region in lay.room_regions.items() if region.contains(p)), None)


def linked_rooms(sg: StairGeom, layouts: dict) -> tuple[str | None, str | None]:
    """(room at the foot, room at the top landing)."""
    low, up = layouts.get(sg.level), layouts.get(sg.to_level)
    return (room_at(low, sg.foot - sg.u * APPROACH) if low else None,
            room_at(up, sg.top + sg.u * APPROACH) if up else None)


def landing_depth(sg: StairGeom, region) -> float:
    """Free floor beyond the top riser, in the climbing direction, up to the
    room boundary."""
    ray = LineString([sg.top, sg.top + sg.u * 20.0])
    inside = ray.intersection(region)
    parts = [g for g in getattr(inside, "geoms", [inside]) if g.length > 0]
    first = min(parts, key=lambda g: Point(sg.top).distance(g), default=None)
    return first.length if first is not None and Point(sg.top).distance(first) < 1e-6 else 0.0
