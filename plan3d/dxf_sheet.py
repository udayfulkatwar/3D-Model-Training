"""Multi-storey DXF sheets (T-016 part 2): split a sheet into floor plans,
read stairs from their tread lines, and merge per-level drafts into one
stacked draft. Used by plan3d.read_dxf.

Conventions read (common on Indian drawing sets): each floor plan titled
"GROUND FLOOR PLAN", "FIRST FLOOR PLAN", ...; stairs on a STAIR/STRS layer
as one line per riser, the flight's sides, a walking line with an arrow,
and UP at the foot; on the floor above, the opening drawn dashed.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass

import numpy as np
from shapely.geometry import Point
from shapely.ops import unary_union

SHEET_SPLIT_M = 2.0        # floor plans on one sheet are further apart than this
TITLE = re.compile(r"\b(BASEMENT|STILT|GROUND|FIRST|SECOND|THIRD|FOURTH|FIFTH)\b", re.I)
ORDER = {"basement": -1, "stilt": 0, "ground": 0, "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
TREAD_TOL = 0.005          # treads of one flight: same length and spacing within 5 mm
STOREY_M = 3.15            # default floor-to-floor: 3.00 m ceiling + 0.15 m slab (the reader's defaults)


@dataclass
class FloorPlan:
    walls: object          # shapely geometry, metres, sheet coordinates
    bbox: tuple[float, float, float, float]
    title: str
    order: float


def floor_plans(walls, texts) -> list[FloorPlan]:
    """Wall groups more than SHEET_SPLIT_M apart are separate floor plans,
    ordered by their titles (else left to right)."""
    clusters = unary_union([g.buffer(SHEET_SPLIT_M / 2) for g in getattr(walls, "geoms", [walls])])
    out = []
    for c in getattr(clusters, "geoms", [clusters]):
        w = walls.intersection(c)
        minx, miny, maxx, maxy = w.bounds
        title, order = "", minx / 1e3                      # untitled: left to right, after titled ones
        near = [t for t in texts if TITLE.search(t.text) and minx - 1 <= t.xy[0] <= maxx + 1
                and miny - 4 <= t.xy[1] <= maxy + 4 and not w.buffer(0.3).contains(Point(t.xy))]
        if near:
            title = near[0].text.strip()
            order = ORDER[TITLE.search(title).group(1).lower()]
        else:
            order = 100 + minx / 1e3
        out.append(FloorPlan(w, (minx - 0.5, miny - 0.5, maxx + 0.5, maxy + 0.5), title, order))
    return sorted(out, key=lambda f: f.order)


def _segments(msp, unit, plan: FloorPlan, layer: re.Pattern, primitives) -> list[tuple[np.ndarray, np.ndarray]]:
    x0, y0, x1, y1 = plan.bbox
    out = []
    for e in msp:
        if not layer.search(e.dxf.layer) or e.dxftype() in ("TEXT", "MTEXT", "HATCH"):
            continue
        if str(e.dxf.get("linetype", "")).upper().startswith("DASH"):
            continue                                       # the opening above a stair, not the stair
        for poly in primitives(e, unit):
            for a, b in zip(poly, poly[1:]):
                if x0 <= min(a[0], b[0]) and max(a[0], b[0]) <= x1 and y0 <= min(a[1], b[1]) and max(a[1], b[1]) <= y1:
                    out.append((a, b))
    return out


def _flights(segs) -> list[dict]:
    """Runs of >= 3 parallel axis-aligned lines of one length, centred on one
    line, evenly spaced: one line per riser."""
    groups: dict[tuple, list] = {}
    for a, b in segs:
        d = b - a
        if abs(d[0]) > 1e-6 and abs(d[1]) > 1e-6:
            continue                                       # arrows and other diagonals
        horiz = abs(d[0]) > abs(d[1])
        length = round(float(np.hypot(*d)) / TREAD_TOL) * TREAD_TOL
        mid = (a + b) / 2
        key = (horiz, length, round(float(mid[0] if horiz else mid[1]) / TREAD_TOL))
        groups.setdefault(key, []).append(mid)
    out = []
    for (horiz, length, _), mids in groups.items():
        axis = 1 if horiz else 0                           # risers of a horizontal tread line stack along y
        mids = sorted(mids, key=lambda m: m[axis])
        uniq = [mids[0]] + [m for p, m in zip(mids, mids[1:]) if abs(m[axis] - p[axis]) > 1e-4]
        if len(uniq) < 3:
            continue
        gaps = np.diff([m[axis] for m in uniq])
        run = [uniq[0]]
        for m, g in zip(uniq[1:], gaps):
            if abs(g - gaps[0]) <= TREAD_TOL:
                run.append(m)
            else:
                break
        if len(run) >= 3:
            out.append({"lines": [np.asarray(m, float) for m in run], "width": length,
                        "going": float(np.mean(np.diff([m[axis] for m in run]))), "axis": axis})
    return out


def read_stairs(msp, unit, plan: FloorPlan, texts, layer, primitives) -> list[dict]:
    """Stairs drawn on this floor plan: straight (one flight) or dog-leg (two
    flights side by side, the one by UP first). `start` is in sheet
    coordinates, `start_local` from the plan's outer south-west corner (the
    draft's origin)."""
    segs = _segments(msp, unit, plan, layer, primitives)
    flights = _flights(segs)
    ups = [np.asarray(t.xy) for t in texts if t.text.strip().upper() == "UP"
           and plan.bbox[0] <= t.xy[0] <= plan.bbox[2] and plan.bbox[1] <= t.xy[1] <= plan.bbox[3]]
    if not flights or not ups:
        return []
    up = ups[0]
    first = min(flights, key=lambda f: min(np.linalg.norm(f["lines"][0] - up), np.linalg.norm(f["lines"][-1] - up)))
    if np.linalg.norm(first["lines"][-1] - up) < np.linalg.norm(first["lines"][0] - up):
        first["lines"] = first["lines"][::-1]              # the foot is the end by UP
    foot = first["lines"][0]
    u = first["lines"][-1] - foot
    u = u / np.linalg.norm(u)
    minx, miny, _, _ = plan.walls.bounds
    stair = {"start": foot, "start_local": foot - np.array([minx, miny]), "u": u, "width": first["width"],
             "going": first["going"], "risers": len(first["lines"]), "type": "straight"}
    others = [f for f in flights if f is not first and f["axis"] == first["axis"]
              and abs(f["width"] - first["width"]) <= TREAD_TOL]
    if others:                                             # dog-leg: the second flight beside the first
        across = np.array([-u[1], u[0]])
        second = min(others, key=lambda f: abs(np.dot(f["lines"][0] - foot, across)))
        offset = float(np.dot(second["lines"][0] - foot, across))
        lines2 = sorted(second["lines"], key=lambda m: -np.dot(m - foot, u))   # it climbs back towards the foot
        run1 = float(np.dot(first["lines"][-1] - foot, u))
        far = [float(np.dot((a + b) / 2 - foot, u)) for a, b in segs
               if abs(float(np.dot(b - a, u))) < 1e-6 and float(np.dot((a + b) / 2 - foot, u)) > run1 + 1e-3]
        stair.update(type="dogleg", risers=len(first["lines"]) + len(lines2),
                     turn="left" if offset > 0 else "right",
                     gap=round(max(abs(offset) - first["width"], 0.0), 4),
                     landing=round(max(far) - run1, 4) if far else first["width"])
    return [stair]


def _rename(plan: dict, level: int) -> dict:
    """Copy of a single-level draft as level `level`, ids prefixed (wall
    types and their thickness items are shared between levels)."""
    p = copy.deepcopy(plan)
    if level == 0:
        return p
    lid, pre = f"L{level:02d}", f"L{level:02d}-"
    ids = {"levels": {"L00": lid}}
    for coll in ("walls", "openings", "rooms", "dimensions"):
        ids[coll] = {x["id"]: (x["id"] if coll == "dimensions" and x["id"].startswith("D-T") else pre + x["id"])
                     for x in p[coll]}
    dims = ids["dimensions"]
    for coll in ("walls", "openings", "rooms", "dimensions", "levels"):
        for x in p[coll]:
            x["id"] = ids[coll].get(x["id"], x["id"])
            if "prov" in x:
                x["prov"] = [dims.get(d, d) for d in x["prov"]]
    for w in p["walls"]:
        w["level"] = lid
    for r in p["rooms"]:
        r["level"] = lid
    for o in p["openings"]:
        o["wall"] = ids["walls"][o["wall"]]
        if o.get("opens_into"):
            o["opens_into"] = ids["rooms"].get(o["opens_into"], o["opens_into"])
    for d in p["dimensions"]:
        chk = d["check"]
        if "level" in chk:
            chk["level"] = lid
        if "room" in chk:
            chk["room"] = ids["rooms"][chk["room"]]
        if "targets" in chk:
            chk["targets"] = [".".join([c, ids.get(c, {}).get(i, i), f]) for c, i, f in
                              (t.split(".") for t in chk["targets"])]
        if d["id"] == pre + "D-003":
            d.update(value=round(level * STOREY_M, 4), status="INFERRED",
                     note="Stacked on the level below with the default heights (3.00 m + 0.15 m slab); confirm")
    return p


def merge_levels(drafts: list[dict], titles: list[str], stairs_per_level: list[list[dict]]) -> dict:
    """One stacked draft from per-level drafts (each with its origin at its
    own outer south-west corner, so floor plans of one building line up)."""
    plans = [_rename(d, i) for i, d in enumerate(drafts)]
    merged = copy.deepcopy(plans[0])
    for i, p in enumerate(plans[1:], start=1):
        lv = p["levels"][0]
        lv.update(elevation=round(i * STOREY_M, 4), name=_level_name(titles[i], i))
        merged["levels"].append(lv)
        for coll in ("walls", "openings", "rooms"):
            merged[coll] += p[coll]
        types = {t["id"] for t in merged["wall_types"]}
        merged["wall_types"] += [t for t in p["wall_types"] if t["id"] not in types]
        dims = {d["id"] for d in merged["dimensions"]}
        merged["dimensions"] += [d for d in p["dimensions"] if d["id"] not in dims]
    merged["levels"][0]["name"] = _level_name(titles[0], 0)
    stairs = []
    for i, draft_stairs in enumerate(stairs_per_level):
        for s in draft_stairs:
            if i + 1 >= len(plans):
                continue                                   # a stair to a floor not drawn
            sid = f"S{len(stairs) + 1:02d}"
            item = {"id": sid, "level": merged["levels"][i]["id"], "to_level": merged["levels"][i + 1]["id"],
                    "start": [round(float(v), 4) for v in s["start_local"]],
                    "direction": _compass(s["u"]), "width": round(s["width"], 4), "risers": s["risers"],
                    "going": round(s["going"], 4), "prov": [f"D-07{len(stairs)}"]}
            if s["type"] == "dogleg":
                item.update(type="dogleg", turn=s["turn"], landing=s["landing"], gap=s["gap"])
            stairs.append(item)
            merged["dimensions"].append({
                "id": f"D-07{len(stairs) - 1}", "label": f"Stair {sid} as drawn", "value": float(s["risers"]),
                "status": "INFERRED", "source": "S-01",
                "check": {"kind": "param", "targets": [f"stairs.{sid}.risers"]},
                "note": (f"Read from the stair's tread lines: {s['type']}, width {s['width']:.3f} m, going "
                         f"{s['going']:.3f} m, {s['risers']} risers; riser height follows from the levels. Confirm")})
    if stairs:
        merged["stairs"] = stairs
    return merged


def _level_name(title: str, i: int) -> str:
    m = TITLE.search(title or "")
    return f"{m.group(1).capitalize()} floor" if m else ("Ground floor" if i == 0 else f"Level {i}")


def _compass(u) -> str:
    return "E" if u[0] > 0.5 else "W" if u[0] < -0.5 else "N" if u[1] > 0.5 else "S"
