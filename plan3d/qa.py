"""Automated QA. Sanity checks only: NOT building-code (UDCPR/NBC) compliance.

Status meanings: PASS, INFO (recorded, no action), WARN (review needed),
FAIL (the model must not be used until fixed).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import shapely
import trimesh
from shapely.geometry import Polygon
from shapely.ops import unary_union

from . import plan2d, stairs
from .mesh3d import ZUP_TO_YUP, Part, stacking
from .model import Plan

DEGENERATE_AREA = 1e-5     # m^2 (lesson L-004)
HABITABLE = {"living", "dining", "kitchen", "bedroom"}


@dataclass
class Check:
    id: str
    name: str
    status: str = "PASS"
    details: list[str] = field(default_factory=list)

    def add(self, status: str, msg: str) -> None:
        order = ["PASS", "INFO", "WARN", "FAIL"]
        if order.index(status) > order.index(self.status):
            self.status = status
        self.details.append(f"[{status}] {msg}")


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)

    def new(self, cid: str, name: str) -> Check:
        c = Check(cid, name)
        self.checks.append(c)
        return c

    def get(self, cid: str) -> Check:
        return next(c for c in self.checks if c.id == cid)

    @property
    def failed(self) -> bool:
        return any(c.status == "FAIL" for c in self.checks)

    def counts(self) -> dict[str, int]:
        out = {s: 0 for s in ("PASS", "INFO", "WARN", "FAIL")}
        for c in self.checks:
            out[c.status] += 1
        return out

    def to_dict(self) -> dict:
        return {"counts": self.counts(), "failed": self.failed,
                "checks": [c.__dict__ for c in self.checks]}


# ---------------------------------------------------------------- plan checks

def check_schema(report: Report, errors: list[str]) -> None:
    c = report.new("Q01", "Schema valid")
    for e in errors:
        c.add("FAIL", e)


def check_references(report: Report, plan: Plan) -> bool:
    c = report.new("Q02", "Unique ids and valid references")
    for d in plan.duplicate_ids:
        c.add("FAIL", f"duplicate id {d}")
    refs = [(f"walls.{w['id']}.level", w["level"], plan.levels) for w in plan.walls.values()]
    refs += [(f"walls.{w['id']}.type", w["type"], plan.wall_types) for w in plan.walls.values()]
    refs += [(f"openings.{o['id']}.wall", o["wall"], plan.walls) for o in plan.openings.values()]
    refs += [(f"rooms.{r['id']}.level", r["level"], plan.levels) for r in plan.rooms.values()]
    refs += [(f"dimensions.{d['id']}.source", d["source"], plan.sources) for d in plan.dimensions.values()]
    refs += [(f"stairs.{s['id']}.{k}", s[k], plan.levels) for s in plan.stairs.values() for k in ("level", "to_level")]
    for coll, item in plan.elements():
        refs += [(f"{coll}.{item['id']}.prov", p, plan.dimensions) for p in item["prov"]]
    for d in plan.dimensions.values():
        chk = d["check"]
        if "room" in chk:
            refs.append((f"dimensions.{d['id']}.check.room", chk["room"], plan.rooms))
        if "level" in chk:
            refs.append((f"dimensions.{d['id']}.check.level", chk["level"], plan.levels))
        for t in chk.get("targets", []):
            try:
                plan.get_param(t)
            except KeyError:
                c.add("FAIL", f"dimensions.{d['id']}.check target '{t}' does not exist")
    for where, ref, index in refs:
        if ref not in index:
            c.add("FAIL", f"{where} -> '{ref}' does not exist")
    return c.status != "FAIL"


def check_provenance(report: Report, plan: Plan) -> None:
    c = report.new("Q03", "Provenance: no geometry depends on an OPEN item")
    for coll, item in plan.elements():
        statuses = {p: plan.dimensions[p]["status"] for p in item["prov"]}
        open_refs = [p for p, s in statuses.items() if s == "OPEN"]
        if open_refs:
            c.add("FAIL", f"{coll}.{item['id']} depends on OPEN {', '.join(open_refs)}")
    inferred = sorted(d["id"] for d in plan.dimensions.values() if d["status"] == "INFERRED")
    if inferred:
        c.add("INFO", f"{len(inferred)} INFERRED dimension(s) in use: {', '.join(inferred)} "
                      "(see uncertainty report)")
    used = {p for _, item in plan.elements() for p in item["prov"]}
    for d in plan.dimensions.values():
        if d["status"] != "OPEN" and d["id"] not in used and d["check"]["kind"] == "none":
            c.add("WARN", f"{d['id']} is neither cited by geometry nor checked")


def check_walls(report: Report, plan: Plan, layouts: dict) -> None:
    c = report.new("Q04", "Wall sanity")
    for lay in layouts.values():
        ws = list(lay.walls.values())
        for w in ws:
            if w.length < 0.1:
                c.add("FAIL", f"wall {w.id} is only {w.length:.3f} m long")
        for i, p in enumerate(ws):
            for q in ws[i + 1:]:
                shared = shapely.LineString([p.start, p.end]).intersection(
                    shapely.LineString([q.start, q.end]))
                if shared.length > 1e-6:
                    c.add("FAIL", f"walls {p.id} and {q.id} overlap along {shared.length:.3f} m")
    for w in plan.walls.values():
        if w["start"] == w["end"]:
            c.add("FAIL", f"wall {w['id']} has zero length")
    for lay in layouts.values():
        for check, status, msg in lay.issues:
            if check == "walls":
                c.add(status, f"{lay.level_id}: {msg}")


def check_envelope_and_rooms(report: Report, plan: Plan, layouts: dict) -> None:
    env = report.new("Q05", "Envelope closed")
    rooms = report.new("Q06", "Rooms resolve to unique enclosed regions")
    for lay in layouts.values():
        for check, status, msg in lay.issues:
            if check != "walls":
                (env if check == "envelope" else rooms).add(status, f"{lay.level_id}: {msg}")
        if lay.outline is not None and not lay.regions:
            env.add("FAIL", f"{lay.level_id}: walls enclose no space (gap in the envelope?)")


def check_openings(report: Report, plan: Plan, layouts: dict) -> None:
    c = report.new("Q07", "Openings fit their walls")
    for lay in layouts.values():
        lv = plan.levels[lay.level_id]
        for msg in plan2d.opening_conflicts(lay):
            c.add("FAIL", msg)
        for og in lay.openings.values():
            if og.head > lv["wall_height"] + 1e-9:
                c.add("FAIL", f"{og.id}: head {og.head:.3f} m is above ceiling {lv['wall_height']:.3f} m")
            if og.kind == "window" and og.sill <= 0:
                c.add("WARN", f"{og.id}: window with zero sill (should it be a door?)")
            if og.kind in ("door", "arch") and og.sill > 0:
                c.add("WARN", f"{og.id}: {og.kind} with sill {og.sill:.3f} m")
            if og.opens_into is not None and (og.kind != "door" or og.opens_into not in og.sides):
                c.add("FAIL", f"{og.id}: opens_into '{og.opens_into}' is not a room beside this door "
                              f"(sides: {og.sides[0]}, {og.sides[1]})")
            if og.sides[0] == og.sides[1]:
                c.add("WARN", f"{og.id}: both sides are '{og.sides[0]}'")


def check_dimensions(report: Report, plan: Plan, layouts: dict) -> None:
    c = report.new("Q08", "Plan conformance: geometry matches the dimension register")
    tol_l, tol_a = plan.tolerances["length"], plan.tolerances["area_rel"]
    for d in plan.dimensions.values():
        chk = d["check"]
        if d["status"] == "OPEN":
            c.add("WARN", f"{d['id']} OPEN: {d['label']}")
            continue
        if chk["kind"] == "none":
            continue
        if chk["kind"] == "param":
            for t in chk["targets"]:
                v = plan.get_param(t)
                if abs(v - d["value"]) > 1e-9:
                    c.add("FAIL", f"{d['id']} ({d['label']}): {t} = {v} but register says {d['value']}")
            continue
        got = plan2d.measure(layouts, plan, chk)
        if got is None:
            c.add("FAIL", f"{d['id']} ({d['label']}): could not be measured")
            continue
        if chk["kind"] == "room_area":
            ok, diff = abs(got - d["value"]) <= tol_a * d["value"], f"{got:.3f} m^2"
        else:
            ok, diff = abs(got - d["value"]) <= tol_l, f"{got * 1000:.1f} mm"
        if not ok:
            stated = f"{d['value']:.3f} m^2" if chk["kind"] == "room_area" else f"{d['value'] * 1000:.1f} mm"
            c.add("FAIL", f"{d['id']} ({d['label']}, {d['status']}): stated {stated}, model {diff}")
    n = sum(1 for d in plan.dimensions.values() if d["check"]["kind"] != "none" and d["status"] != "OPEN")
    c.add("INFO", f"{n} dimension checks evaluated")


def check_circulation(report: Report, plan: Plan, layouts: dict) -> None:
    c = report.new("Q09", "Circulation: every room reachable through doors and stairs")
    graph: dict[str, set[str]] = {}
    ground = min((plan.levels[lid]["elevation"] for lid in layouts), default=0.0)
    for lid, lay in layouts.items():
        # only outside doors on the lowest level are entrances; an upper level's outside door
        # (balcony, terrace) leads to its own outside, not down to the street
        outside = plan2d.EXTERIOR if plan.levels[lid]["elevation"] == ground else f"{plan2d.EXTERIOR}@{lid}"
        for node, nbrs in plan2d.circulation(lay).items():
            node = outside if node == plan2d.EXTERIOR else node
            graph.setdefault(node, set()).update(outside if n == plan2d.EXTERIOR else n for n in nbrs)
    for sg in stairs.build(plan).values():
        low, up = stairs.linked_rooms(sg, layouts)
        if low and up:
            graph.setdefault(low, set()).add(up)
            graph.setdefault(up, set()).add(low)
    reach = plan2d.reachable_from_exterior(graph)
    if not graph.get(plan2d.EXTERIOR):
        c.add("FAIL", "no door to the exterior")
    for lay in layouts.values():
        for rid in sorted(lay.room_regions):
            if rid not in reach:
                c.add("FAIL", f"{rid} ({plan.rooms[rid]['name']}) cannot be reached from the entrance")


def check_daylight(report: Report, plan: Plan, layouts: dict) -> None:
    c = report.new("Q10", "Daylight/ventilation sanity (not a code check)")
    for lay in layouts.values():
        lit: dict[str, float] = defaultdict(float)
        for og in lay.openings.values():
            if og.kind == "window" and plan2d.EXTERIOR in og.sides:
                room = next((s for s in og.sides if s != plan2d.EXTERIOR), None)
                lit[room] += (og.b - og.a) * (og.head - og.sill)
        for rid, region in sorted(lay.room_regions.items()):
            use = plan.rooms[rid]["use"]
            if use in HABITABLE and rid not in lit:
                c.add("WARN", f"{rid} ({plan.rooms[rid]['name']}): habitable room has no external window")
            elif use == "toilet" and rid not in lit:
                c.add("WARN", f"{rid} ({plan.rooms[rid]['name']}): no external window; "
                              "needs mechanical ventilation (confirm with architect)")
            elif rid in lit:
                c.add("INFO", f"{rid}: glazing {lit[rid]:.2f} m^2 = "
                              f"{100 * lit[rid] / region.area:.1f}% of floor area")


def check_door_swing(report: Report, plan: Plan, layouts: dict) -> None:
    c = report.new("Q18", "Door swing clearance (each door can open 90 degrees)")
    for lay in layouts.values():
        for og in sorted(lay.openings.values(), key=lambda o: o.id):
            if og.kind != "door":
                continue
            sweep = plan2d.door_sweep(lay, og).buffer(-1e-4)
            for w in lay.walls.values():
                if w.id == og.wall_id:
                    continue
                hit = sweep.intersection(w.poly).area
                if hit > 1e-4:
                    c.add("WARN", f"{og.id}: leaf swing hits wall {w.id} ({hit * 1e4:.0f} cm^2); "
                                  "change hinge side, swing direction or position")
            others = [o for o in lay.openings.values() if o.kind == "door" and o.id < og.id]
            for o in others:
                if sweep.intersection(plan2d.door_sweep(lay, o).buffer(-1e-4)).area > 1e-4:
                    c.add("WARN", f"{og.id} and {o.id}: door swings overlap")


# ---------------------------------------------------------------- mesh checks

def check_walk_tests(report: Report, plan: Plan, layouts: dict, parts: list[Part]) -> list[dict]:
    """Q19: probe lines through doors pass, at walls and windows are blocked."""
    from . import walktests
    c = report.new("Q19", "Walk tests: doors and arches passable, walls and glass blocking")
    results = walktests.run(walktests.generate(plan, layouts), parts)
    for r in results:
        if not r["ok"]:
            what = f"hit {r['hit']}" if r["hit"] else "nothing hit"
            c.add("FAIL", f"{r['name']}: expected {'blocked' if r['expect_hit'] else 'clear'}, {what}")
    c.add("INFO", f"{sum(r['ok'] for r in results)}/{len(results)} probes as expected")
    return results

def check_clearance(report: Report, plan: Plan, layouts: dict, parts: list[Part]) -> list[dict]:
    """Q20: clear walking width of doors and arches after frames and open leaves."""
    from . import walktests
    c = report.new("Q20", "Clear walking width through doors and arches")
    results = walktests.clearances(plan, layouts, parts)
    for r in results:
        if r["clear_m"] < walktests.WALKER_WIDTH:
            c.add("WARN", f"{r['name']}: clear width {r['clear_m']:.3f} m is below a "
                          f"{walktests.WALKER_WIDTH:.2f} m walkthrough body")
    c.add("INFO", "Clear widths: " + ", ".join(f"{r['name']} {r['clear_m']:.3f} m" for r in results))
    tight = [r["name"] for r in results if r["clear_m"] < walktests.DEFAULT_PAWN_WIDTH]
    if tight:
        c.add("INFO", f"Unreal's DefaultPawn ({walktests.DEFAULT_PAWN_WIDTH:.2f} m) cannot pass "
                      f"{', '.join(tight)}; use a walkthrough pawn of at most {min(r['clear_m'] for r in results):.2f} m")
    return results


def check_stacking_and_stairs(report: Report, plan: Plan, layouts: dict) -> None:
    """Q21: levels sit on each other; each stair starts and ends in a room,
    stays clear of walls, and has a comfortable rise and going."""
    c = report.new("Q21", "Levels stack; stairs fit and climb comfortably")
    above = stacking(plan)
    lowest = min((lv["elevation"] for lv in plan.levels.values()), default=0.0)
    for lv in plan.levels.values():
        if lv["elevation"] > lowest and lv["id"] not in above.values():
            c.add("FAIL", f"{lv['id']}: does not sit on a level below (its elevation must equal the lower "
                          f"floor level + wall height + slab, and its floor thickness that slab)")
    for sg in sorted(stairs.build(plan).values(), key=lambda s: s.id):
        if above.get(sg.level) != sg.to_level:
            c.add("FAIL", f"{sg.id}: {sg.to_level} is not the level directly above {sg.level}")
            continue
        two_r_g = 2 * sg.riser + sg.going
        shape = (f"run {sg.run:.3f} m" if sg.kind == "straight" else
                 f"dog-leg {' + '.join(str(f.risers) for f in sg.flights)} risers, landing {sg.landing:.3f} m")
        c.add("INFO", f"{sg.id}: {sg.risers} risers of {sg.riser * 1000:.1f} mm, going {sg.going * 1000:.0f} mm, "
                      f"2R+G = {two_r_g * 1000:.0f} mm, {shape}")
        if sg.kind == "dogleg" and sg.landing < sg.width:
            c.add("WARN", f"{sg.id}: half landing {sg.landing:.3f} m is shallower than the stair width {sg.width:.3f} m")
        if sg.riser > stairs.MAX_RISER or sg.going < stairs.MIN_GOING:
            c.add("WARN", f"{sg.id}: riser {sg.riser * 1000:.0f} mm / going {sg.going * 1000:.0f} mm outside "
                          f"{stairs.MAX_RISER * 1000:.0f} / {stairs.MIN_GOING * 1000:.0f} mm (confirm with the code)")
        if not stairs.BLONDEL[0] <= two_r_g <= stairs.BLONDEL[1]:
            c.add("WARN", f"{sg.id}: 2R+G {two_r_g * 1000:.0f} mm outside the comfortable "
                          f"{stairs.BLONDEL[0] * 1000:.0f}-{stairs.BLONDEL[1] * 1000:.0f} mm")
        low, up = stairs.linked_rooms(sg, layouts)
        if low is None:
            c.add("FAIL", f"{sg.id}: the foot of the stair is not inside a room on {sg.level}")
        elif sg.footprint.difference(layouts[sg.level].room_regions[low]).area > 1e-6:
            c.add("FAIL", f"{sg.id}: the flight crosses a wall on {sg.level}")
        if up is None:
            c.add("FAIL", f"{sg.id}: the top landing is not inside a room on {sg.to_level}")
            continue
        region = layouts[sg.to_level].room_regions[up]
        if sg.footprint.intersection(layouts[sg.to_level].footprint).area > 1e-6:
            c.add("FAIL", f"{sg.id}: the opening in the {sg.to_level} floor cuts a wall")
        depth = stairs.landing_depth(sg, region)
        if depth < sg.width:
            c.add("WARN", f"{sg.id}: landing {depth:.3f} m deep, less than the stair width {sg.width:.3f} m")
        else:
            c.add("INFO", f"{sg.id}: {low} -> {up}, landing {depth:.3f} m deep")


def check_headroom(report: Report, plan: Plan, parts: list[Part]) -> None:
    """Q22: nothing within HEADROOM above any tread."""
    from . import walktests
    c = report.new("Q22", f"Stair headroom ({stairs.HEADROOM:.1f} m above every tread)")
    scene = walktests.Scene(parts)
    for sg in sorted(stairs.build(plan).values(), key=lambda s: s.id):
        for k, p in enumerate(sg.tread_centres()):
            hit, t = scene.first_hit_at(p + [0, 0, 1e-4], p + [0, 0, stairs.HEADROOM])
            if hit is not None:
                c.add("FAIL", f"{sg.id} tread {k + 1}: {hit} {t * stairs.HEADROOM:.3f} m above the tread")
        c.add("INFO", f"{sg.id}: {len(sg.tread_centres())} treads and landings checked")


def check_solids(report: Report, parts: list[Part]) -> None:
    c = report.new("Q11", "Solids are closed, finite and positive-volume")
    for p in parts:
        m = p.solid
        if len(m.faces) == 0:
            c.add("FAIL", f"{p.name}: empty mesh")
            continue
        if not np.isfinite(m.vertices).all():
            c.add("FAIL", f"{p.name}: non-finite vertices")
        if not m.is_watertight:
            c.add("FAIL", f"{p.name}: not watertight")
        if m.volume <= 0:
            c.add("FAIL", f"{p.name}: volume {m.volume:.6f}")


def check_degenerate(report: Report, parts: list[Part]) -> None:
    c = report.new("Q12", f"No degenerate faces (< {DEGENERATE_AREA:g} m^2)")
    for p in parts:
        n = int((p.solid.area_faces < DEGENERATE_AREA).sum())
        if n:
            c.add("FAIL", f"{p.name}: {n} degenerate face(s)")


def _plane_groups(parts: list[Part]):
    """faces grouped by plane: key -> {(part, sign): [2D triangles]}"""
    groups: dict = defaultdict(lambda: defaultdict(list))
    for p in parts:
        m = p.solid
        for n, tri in zip(m.face_normals, m.triangles, strict=True):
            k = int(np.abs(n).argmax())
            sign = 1 if n[k] > 0 else -1
            canon = n * sign
            d = float(canon @ tri[0])
            key = (tuple(np.round(canon, 4)), round(d, 4))
            keep = [i for i in range(3) if i != k]
            groups[key][(p.name, sign)].append(Polygon(tri[:, keep]))
    return groups


def check_coplanar(report: Report, parts: list[Part]) -> None:
    c = report.new("Q13", "No coplanar overlapping faces between parts (z-fighting)")
    touching = 0
    for key, members in _plane_groups(parts).items():
        if len({name for name, _ in members}) < 2:
            continue
        areas = {mk: unary_union(tris) for mk, tris in members.items()}
        names = sorted(areas)
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                if a[0] == b[0]:
                    continue
                overlap = areas[a].intersection(areas[b]).area
                if overlap <= 1e-6:
                    continue
                if a[1] == b[1]:
                    c.add("FAIL", f"{a[0]} and {b[0]} overlap {overlap:.4f} m^2 in plane "
                                  f"n={key[0]} d={key[1]} (both facing the same way)")
                else:
                    touching += 1
    if touching:
        c.add("INFO", f"{touching} face pair(s) where touching solids meet back to back "
                      "(hidden, expected)")


def check_uvs(report: Report, scene: trimesh.Scene) -> None:
    c = report.new("Q15", "Every exported mesh has UVs")
    for name, g in scene.geometry.items():
        uv = getattr(g.visual, "uv", None)
        if uv is None or len(uv) != len(g.vertices) or not np.isfinite(uv).all():
            c.add("FAIL", f"{name}: missing or invalid UVs")


def check_floor_areas(report: Report, plan: Plan, parts: list[Part], layouts: dict) -> None:
    c = report.new("Q14", "3D floor areas equal 2D room areas (less stair openings)")
    voids: dict[str, Polygon] = {}
    for sg in stairs.build(plan).values():
        voids[sg.to_level] = unary_union([voids.get(sg.to_level, Polygon()), sg.footprint])
    for p in parts:
        if p.role != "floor" or p.ref not in plan.rooms:
            continue
        ffl = plan.levels[p.level]["elevation"]
        m = p.solid
        top = (m.face_normals[:, 2] > 0.999) & (np.abs(m.triangles_center[:, 2] - ffl) < 1e-6)
        region = layouts[p.level].room_regions[p.ref].difference(voids.get(p.level, Polygon()))
        a3, a2 = float(m.area_faces[top].sum()), region.area
        if abs(a3 - a2) > 1e-6 * max(a2, 1):
            c.add("FAIL", f"{p.name}: 3D {a3:.6f} m^2 vs 2D {a2:.6f} m^2")


def check_glb_roundtrip(report: Report, glb_path, parts: list[Part]) -> None:
    c = report.new("Q16", "GLB re-import matches what was built")
    loaded = trimesh.load(glb_path, force="scene")
    inv = np.linalg.inv(ZUP_TO_YUP)
    names = set(loaded.geometry)
    for p in parts:
        if p.name not in names:
            c.add("FAIL", f"{p.name}: missing from GLB")
            continue
        g = loaded.geometry[p.name]
        if len(g.faces) != len(p.solid.faces):
            c.add("FAIL", f"{p.name}: {len(g.faces)} faces in GLB, {len(p.solid.faces)} built")
        bounds = trimesh.transform_points(g.vertices, inv)
        lo, hi = bounds.min(0), bounds.max(0)
        if not (np.allclose(lo, p.solid.bounds[0], atol=1e-5)
                and np.allclose(hi, p.solid.bounds[1], atol=1e-5)):
            c.add("FAIL", f"{p.name}: bounds changed after export")
        if getattr(g.visual, "uv", None) is None:
            c.add("FAIL", f"{p.name}: UVs lost in GLB")
    extra = names - {p.name for p in parts}
    if extra:
        c.add("FAIL", f"unexpected meshes in GLB: {sorted(extra)}")
