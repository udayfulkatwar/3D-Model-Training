"""T-006 benchmark: render known plans as drawings, read them back, score the
draft against the truth. Targets are the pre-registered ones in
docs/T006_PLAN_READING.md.

    python -m bench.run            # writes out/bench/results.json and prints a table
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from plan3d import plan2d
from plan3d.build import build
from plan3d.model import Plan, load_plan
from plan3d.read_raster import read_plan

from .drawing import degrade, render

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "bench"
PLANS = ["t01", "t02"]
CASES = {
    "clean-100": {"ppm": 100, "degrade": False},
    "clean-60": {"ppm": 60, "degrade": False},
    "scan-100": {"ppm": 100, "degrade": True},
}
# Exploratory drawing styles never used while developing the reader (not pre-registered).
EXPLORE = {
    "clean-80": {"ppm": 80, "degrade": False},
    "thickpen-100": {"ppm": 100, "degrade": False, "pen_m": 0.03},
    "thickpen-scan-100": {"ppm": 100, "degrade": True, "pen_m": 0.03},
}
# Holdout 2 (docs/T006_PLAN_READING.md): new resolution and a harsher, opposite-sign scan.
HOLDOUT2 = {
    "clean-100": {"ppm": 100, "degrade": False},
    "scan2-150": {"ppm": 150, "degrade": {"rotate_deg": -2.5, "blur": 1.2, "noise": 18.0, "jpeg": 50, "seed": 11}},
}
# Hollow (outline) walls, registered 2026-10-20 (docs/T006_PLAN_READING.md): development on T01/T02 ...
HOLLOW = {
    "hollow-clean-100": {"ppm": 100, "degrade": False, "style": "hollow"},
    "hollow-clean-60": {"ppm": 60, "degrade": False, "style": "hollow"},
    "hollow-scan-100": {"ppm": 100, "degrade": True, "style": "hollow"},
}
# ... and a holdout on T03/T04, run once after the reader is frozen.
HOLLOW_HOLDOUT = {
    "hollow-clean-100": {"ppm": 100, "degrade": False, "style": "hollow"},
    "hollow-scan2-150": {"ppm": 150, "style": "hollow",
                         "degrade": {"rotate_deg": -2.5, "blur": 1.2, "noise": 18.0, "jpeg": 50, "seed": 11}},
}
TARGETS = {   # pre-registered; do not edit after results are known
    "clean": {"offset_mm": 15, "rooms": 1.0, "area_err": 0.02, "recall": 1.0, "precision": 1.0,
              "kind": 1.0, "swing": 0.9, "width_mm": 30},
    "scan": {"offset_mm": 25, "rooms": 1.0, "area_err": 0.03, "recall": 0.9, "precision": 0.9,
             "kind": 0.9, "swing": 0.8, "width_mm": 50},
}


def _layout(plan_path):
    plan, err = load_plan(plan_path)
    assert plan is not None, err
    return plan, plan2d.build_layout(plan, "L00")


def score(truth_path: Path, draft_path: Path) -> dict:
    tplan, tl = _layout(truth_path)
    dplan = Plan(json.loads(draft_path.read_text()))
    dl = plan2d.build_layout(dplan, "L00")

    offset_mm = 1000 * tl.footprint.symmetric_difference(dl.footprint).area / tl.footprint.boundary.length

    room_map, area_errs = {}, []
    for rid, reg in tl.room_regions.items():
        best = max(((did, reg.intersection(d).area / reg.union(d).area) for did, d in dl.room_regions.items()),
                   key=lambda t: t[1], default=(None, 0))
        if best[1] >= 0.9:
            room_map[best[0]] = rid
            area_errs.append(abs(dl.room_regions[best[0]].area - reg.area) / reg.area)

    def ops(lay):
        out = []
        for og in lay.openings.values():
            wg = lay.walls[og.wall_id]
            out.append({"id": og.id, "kind": og.kind, "c": og.center, "w": og.b - og.a,
                        "h": abs(wg.direction[0]) > 0.5, "into": og.opens_into})
        return out

    t_ops, d_ops = ops(tl), ops(dl)
    used, matches = set(), []
    for t in t_ops:
        cands = [d for d in d_ops if d["id"] not in used and d["h"] == t["h"]
                 and np.linalg.norm(d["c"] - t["c"]) <= 0.3]
        if cands:
            d = min(cands, key=lambda d: np.linalg.norm(d["c"] - t["c"]))
            used.add(d["id"])
            matches.append((t, d))
    doors = [(t, d) for t, d in matches if t["kind"] == "door" and d["kind"] == "door"]
    swing_ok = [room_map.get(d["into"]) == (t["into"] or None) for t, d in doors]
    qa = build(draft_path, draft_path.parent / "build").report
    return {
        "offset_mm": round(offset_mm, 2),
        "rooms": len(area_errs) / len(tl.room_regions),
        "area_err_max": round(max(area_errs), 4) if area_errs else None,
        "recall": len(matches) / len(t_ops),
        "precision": len(matches) / len(d_ops) if d_ops else 0.0,
        "kind": sum(t["kind"] == d["kind"] for t, d in matches) / len(matches) if matches else 0.0,
        "swing": sum(swing_ok) / len(swing_ok) if swing_ok else None,
        "center_err_mm": round(1000 * float(np.mean([np.linalg.norm(d["c"] - t["c"]) for t, d in matches])), 1)
        if matches else float("nan"),
        "width_err_mm": round(1000 * float(np.mean([abs(d["w"] - t["w"]) for t, d in matches])), 1)
        if matches else float("nan"),
        "width_bias_mm": {k: round(1000 * float(np.mean([d["w"] - t["w"] for t, d in matches if t["kind"] == k])), 1)
                          for k in ("door", "window", "arch") if any(t["kind"] == k for t, _ in matches)},
        "builds_without_fail": not qa.failed,
        "missed": [f"{t['id']} {t['kind']} at ({t['c'][0]:.2f}, {t['c'][1]:.2f})"
                   for t in t_ops if all(t is not mt for mt, _ in matches)],
        "spurious": [f"{d['id']} {d['kind']} at ({d['c'][0]:.2f}, {d['c'][1]:.2f})"
                     for d in d_ops if d["id"] not in used],
        "wrong_kind": [f"{t['id']} {t['kind']} read as {d['kind']}" for t, d in matches if t["kind"] != d["kind"]],
        "counts": {"truth_openings": len(t_ops), "draft_openings": len(d_ops),
                   "truth_rooms": len(tl.room_regions), "draft_rooms": len(dl.room_regions)},
    }


def verdict(m: dict, case: str) -> dict:
    t = TARGETS["scan" if "scan" in case else "clean"]
    checks = {
        "offset": m["offset_mm"] <= t["offset_mm"],
        "rooms": m["rooms"] >= t["rooms"],
        "area": m["area_err_max"] is not None and m["area_err_max"] <= t["area_err"],
        "recall": m["recall"] >= t["recall"],
        "precision": m["precision"] >= t["precision"],
        "kind": m["kind"] >= t["kind"],
        "swing": m["swing"] is None or m["swing"] >= t["swing"],
        "width": m["width_err_mm"] <= t["width_mm"],
        "builds": m["builds_without_fail"],
    }
    return {"pass": all(checks.values()), "missed": [k for k, ok in checks.items() if not ok]}


def main(argv: list[str] | None = None) -> int:
    """python -m bench.run [plan ...] [--out name.json]   (default: the development plans)"""
    argv = sys.argv[1:] if argv is None else argv
    out_name = "results.json"
    if "--out" in argv:
        i = argv.index("--out")
        out_name = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    cases = CASES
    if "--explore" in argv:
        argv = [a for a in argv if a != "--explore"]
        cases = EXPLORE
    if "--holdout2" in argv:
        argv = [a for a in argv if a != "--holdout2"]
        cases = HOLDOUT2
    if "--hollow" in argv:
        argv = [a for a in argv if a != "--hollow"]
        cases = HOLLOW
    if "--hollow-holdout" in argv:
        argv = [a for a in argv if a != "--hollow-holdout"]
        cases = HOLLOW_HOLDOUT
    plans = argv or PLANS
    OUT.mkdir(parents=True, exist_ok=True)
    results = {}
    for p in plans:
        truth = ROOT / "projects" / p / "plan.json"
        for case, cfg in cases.items():
            img = OUT / f"{p}_{case}.png"
            info = render(truth, img, cfg["ppm"], **{k: cfg[k] for k in ("pen_m", "style") if k in cfg})
            if cfg["degrade"]:
                jpg = img.with_suffix(".jpg")
                degrade(img, jpg, **(cfg["degrade"] if isinstance(cfg["degrade"], dict) else {}))
                img = jpg
            res = read_plan(img, OUT / f"{p}_{case}", known_width_m=info["overall_x_m"])
            m = score(truth, OUT / f"{p}_{case}" / "plan.json")
            m["reader"] = res.stats
            m["verdict"] = verdict(m, case)
            results[f"{p}/{case}"] = m
    (OUT / out_name).write_text(json.dumps(results, indent=2, default=float))
    print(f"{'run':16} {'offset':>7} {'rooms':>5} {'area%':>6} {'rec':>5} {'prec':>5} {'kind':>5} "
          f"{'swing':>5} {'ctr':>5} {'width':>6}  verdict")
    for k, m in results.items():
        print(f"{k:16} {m['offset_mm']:7.2f} {m['rooms']:5.2f} {100 * (m['area_err_max'] or 0):6.2f} "
              f"{m['recall']:5.2f} {m['precision']:5.2f} {m['kind']:5.2f} {m['swing'] or 0:5.2f} "
              f"{m['center_err_mm']:5.1f} {m['width_err_mm']:6.1f}  "
              f"{'PASS' if m['verdict']['pass'] else 'MISS ' + ','.join(m['verdict']['missed'])}")
    return 0 if all(m["verdict"]["pass"] for m in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
