"""Human-readable outputs: room schedule, uncertainty report, QA summary,
manifest and the 2D plan drawing used for visual cross-checking (L-005)."""

from __future__ import annotations

import csv
import json
import math
from datetime import date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Arc, Polygon as MplPolygon  # noqa: E402
from shapely.ops import polylabel, unary_union  # noqa: E402

from . import plan2d, stairs  # noqa: E402
from .units import sqm_to_sqft  # noqa: E402

DISCLAIMER = ("Visualization model only. Not for construction. Automated checks are "
              "sanity checks, not UDCPR/NBC/BIS compliance.")


def _room_rows(plan, layouts):
    rows = []
    for lid, lay in layouts.items():
        lit = {}
        for og in lay.openings.values():
            for side in og.sides:
                lit.setdefault(side, {"window": 0, "door": 0, "arch": 0})[og.kind] += 1
        for rid, region in sorted(lay.room_regions.items()):
            room = plan.rooms[rid]
            minx, miny, maxx, maxy = region.bounds
            inferred = sorted(p for p in room["prov"] if plan.dimensions[p]["status"] == "INFERRED")
            counts = lit.get(rid, {"window": 0, "door": 0, "arch": 0})
            rows.append({
                "RoomID": rid, "Name": room["name"], "Level": lid, "Use": room["use"],
                "ClearX_m": round(maxx - minx, 4), "ClearY_m": round(maxy - miny, 4),
                "Area_m2": round(region.area, 3), "Area_sqft": round(sqm_to_sqft(region.area), 1),
                "Windows": counts["window"], "Doors": counts["door"] + counts["arch"],
                "InferredInputs": " ".join(inferred),
            })
    return rows


def write_room_schedule(plan, layouts, out: Path) -> list[Path]:
    rows = _room_rows(plan, layouts)
    path = out / "rooms.csv"
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]) if rows else ["RoomID"])
        w.writeheader()
        w.writerows(rows)
    return [path]


def write_manifest(plan, layouts, parts, out: Path, version: str) -> Path:
    total = sum(r["Area_m2"] for r in _room_rows(plan, layouts))
    manifest = {
        "generator": f"plan3d {version}",
        "plan": {"id": plan.project["id"], "name": plan.project["name"],
                 "nature": plan.project["nature"], "sha256": plan.sha256},
        "units": "metres",
        "axes": "glTF 2.0 Y-up. Plan +X (east) -> +X, plan +Y (north) -> -Z, up -> +Y.",
        "disclaimer": DISCLAIMER,
        "carpet_area_total_m2": round(total, 3),
        "carpet_area_total_sqft": round(sqm_to_sqft(total), 1),
        "meshes": [{
            "name": p.name, "role": p.role, "level": p.level, "ref": p.ref,
            "triangles": len(p.solid.faces), "watertight": bool(p.solid.is_watertight),
            "volume_m3": round(float(p.solid.volume), 6),
            "bounds_zup_m": [[round(float(v), 6) for v in row] for row in p.solid.bounds],
        } for p in parts],
        "rooms": _room_rows(plan, layouts),
    }
    path = out / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2))
    return path


def write_uncertainty(plan, out: Path) -> Path:
    users: dict[str, list[str]] = {}
    for coll, item in plan.elements():
        for p in item["prov"]:
            users.setdefault(p, []).append(f"{coll}.{item['id']}")
    lines = [f"# Uncertainty report: {plan.project['name']}", "",
             f"Nature: {plan.project['nature']}. Generated {date.today().isoformat()}.", "",
             DISCLAIMER, ""]
    for status, title in (("INFERRED", "Inferred values (in the model, need confirmation)"),
                          ("OPEN", "Open questions (not in the model)")):
        dims = [d for d in plan.dimensions.values() if d["status"] == status]
        lines += [f"## {title}", ""]
        if not dims:
            lines += ["None.", ""]
            continue
        lines += ["| ID | Item | Value | Reason | Used by |", "|---|---|---|---|---|"]
        for d in dims:
            used = users.get(d["id"], [])
            shown = ", ".join(used[:6]) + (f" (+{len(used) - 6} more)" if len(used) > 6 else "")
            val = "-" if d.get("value") is None else f"{d['value']:g}"
            lines.append(f"| {d['id']} | {d['label']} | {val} | {d.get('note', '')} | {shown or '-'} |")
        lines.append("")
    path = out / "uncertainty.md"
    path.write_text("\n".join(lines))
    return path


def write_qa_markdown(report, plan, out: Path) -> Path:
    c = report.counts()
    name = plan.project["name"] if plan else "(plan failed to load)"
    verdict = "FAILED: do not use this model" if report.failed else "No blocking failures"
    lines = [f"# QA report: {name}", "",
             f"**{verdict}.** PASS {c['PASS']} · INFO {c['INFO']} · WARN {c['WARN']} · FAIL {c['FAIL']}",
             "", DISCLAIMER, "", "| ID | Check | Status |", "|---|---|---|"]
    lines += [f"| {k.id} | {k.name} | {k.status} |" for k in report.checks]
    lines.append("")
    for k in report.checks:
        if k.details:
            lines += [f"### {k.id} {k.name}", ""] + [f"- {d}" for d in k.details] + [""]
    path = out / "qa_report.md"
    path.write_text("\n".join(lines))
    return path


def write_drawings(plan, layouts, out: Path) -> Path:
    """One PNG plan per level, for overlaying against the source drawing."""
    rows = {r["RoomID"]: r for r in _room_rows(plan, layouts)}
    first = None
    for lid, lay in layouts.items():
        if lay.footprint.is_empty:
            continue
        fig, ax = plt.subplots(figsize=(11.69, 8.27), dpi=150)   # A4 landscape
        for geom in getattr(lay.footprint, "geoms", [lay.footprint]):
            ax.add_patch(MplPolygon(geom.exterior.coords, closed=True, fc="#3a3a3c", ec="none"))
            for hole in geom.interiors:
                ax.add_patch(MplPolygon(hole.coords, closed=True, fc="white", ec="none"))
        for og in lay.openings.values():
            ax.add_patch(MplPolygon(og.rect.exterior.coords, closed=True, fc="white", ec="none"))
            wg = lay.walls[og.wall_id]
            if og.kind == "window":
                for off in (-wg.thickness / 6, wg.thickness / 6):
                    p0, p1 = wg.point_at(og.a) + wg.normal * off, wg.point_at(og.b) + wg.normal * off
                    ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color="#2b7bb9", lw=1)
            elif og.kind == "door":
                hinge, u = plan2d.door_hinge(lay, og)
                n = wg.normal * plan2d.door_side(og)
                w = og.b - og.a
                leaf = hinge + n * w
                ax.plot([hinge[0], leaf[0]], [hinge[1], leaf[1]], color="#e0782f", lw=1)
                a_u = math.degrees(math.atan2(u[1], u[0]))
                a_n = math.degrees(math.atan2(n[1], n[0]))
                lo, hi = (a_u, a_n) if (a_n - a_u) % 360 <= 180 else (a_n, a_u)
                ax.add_patch(Arc(hinge, 2 * w, 2 * w, angle=0, theta1=lo, theta2=hi,
                                 color="#e0782f", lw=0.6, ls="--"))
            else:
                p0, p1 = wg.point_at(og.a), wg.point_at(og.b)
                ax.plot([p0[0], p1[0]], [p0[1], p1[1]], color="#6e6e73", lw=0.8, ls=":")
        flights = stairs.build(plan).values()
        open_below = [sg.footprint for sg in flights if sg.to_level == lid]
        for rid, region in lay.room_regions.items():
            r, c = rows[rid], region.representative_point()
            free = region.difference(unary_union(open_below)) if open_below else region
            if free.area < region.area:              # keep the label off the stair opening
                c = polylabel(max(getattr(free, "geoms", [free]), key=lambda g: g.area), tolerance=0.01)
            ax.text(c.x, c.y, f"{r['Name']}\n{r['ClearX_m']:.3f} × {r['ClearY_m']:.3f} m\n"
                    f"{r['Area_m2']:.2f} m² · {r['Area_sqft']:.0f} sq ft",
                    ha="center", va="center", fontsize=7, color="#1d1d1f")
        for poly in lay.unassigned:
            c = poly.representative_point()
            ax.text(c.x, c.y, "UNASSIGNED", ha="center", color="red", fontsize=7)
        for sg in flights:
            outline = list(sg.footprint.exterior.coords)
            if sg.level == lid:                        # flight: treads and an "UP" arrow
                ax.add_patch(MplPolygon(outline, closed=True, fc="none", ec="#1d1d1f", lw=0.8))
                half = sg.across * sg.width / 2
                for k in range(1, sg.risers - 1):
                    p = sg.foot + sg.u * sg.going * k
                    ax.plot(*zip(p - half, p + half), color="#1d1d1f", lw=0.4)
                ax.annotate("UP", sg.top - sg.u * 0.2, sg.foot + sg.u * 0.2, fontsize=6, ha="center",
                            arrowprops=dict(arrowstyle="->", lw=0.6))
            elif sg.to_level == lid:                   # opening in this floor
                ax.add_patch(MplPolygon(outline, closed=True, fc="none", ec="#6e6e73", lw=0.8, ls="--"))
                c = sg.footprint.centroid
                c = sg.foot + sg.u * sg.run * 0.3
                ax.text(c[0], c[1], f"{sg.id}\nOPEN\nTO\nBELOW", ha="center", va="center", fontsize=6,
                        color="#6e6e73")
        minx, miny, maxx, maxy = lay.footprint.bounds
        ax.annotate("", (minx, miny - 0.6), (maxx, miny - 0.6),
                    arrowprops=dict(arrowstyle="<->", lw=0.6))
        ax.text((minx + maxx) / 2, miny - 0.85, f"{(maxx - minx) * 1000:.0f}", ha="center", fontsize=7)
        ax.annotate("", (minx - 0.6, miny), (minx - 0.6, maxy),
                    arrowprops=dict(arrowstyle="<->", lw=0.6))
        ax.text(minx - 0.85, (miny + maxy) / 2, f"{(maxy - miny) * 1000:.0f}", va="center",
                rotation=90, fontsize=7)
        ax.annotate("N", (maxx + 0.8, maxy), (maxx + 0.8, maxy - 1.0), ha="center",
                    arrowprops=dict(arrowstyle="->", lw=1), fontsize=9)
        ax.plot([maxx - 1, maxx], [miny - 1.3, miny - 1.3], color="k", lw=2)
        ax.text(maxx - 0.5, miny - 1.55, "1 m", ha="center", fontsize=7)
        ax.set_title(f"{plan.project['name']}: {plan.levels[lid]['name']} plan (generated)\n"
                     f"{plan.project['nature']}. {DISCLAIMER}", fontsize=8)
        ax.set_aspect("equal")
        ax.set_xlim(minx - 1.5, maxx + 1.5)
        ax.set_ylim(miny - 2.0, maxy + 1.0)
        ax.axis("off")
        path = out / f"plan_{lid}.png"
        fig.savefig(path, bbox_inches="tight")
        plt.close(fig)
        first = first or path
    return first
