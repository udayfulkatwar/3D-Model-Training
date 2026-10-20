"""T-016 benchmark: write known plans as DXF, read them back, score the
draft against the truth with the pre-registered targets in
docs/T016_DXF_INTAKE.md.

    python -m bench.dxf_run                 # development plans (T01, T02)
    python -m bench.dxf_run --holdout       # T03-T06, run once after the reader is frozen
"""

from __future__ import annotations

import json
import sys

from plan3d import plan2d
from plan3d.model import Plan, load_plan
from plan3d.read_dxf import read_dxf

from .dxf_drawing import write
from .run import ROOT, score

OUT = ROOT / "out" / "bench_dxf"
DEV = ["t01", "t02"]
HOLDOUT = ["t03", "t04", "t05", "t06"]
STYLES = ["poly", "lines", "hatched"]
EXPLORE = ["gappy", "overshoot"]        # not pre-registered: real files' untidy line ends
TARGETS = {"offset_mm": 2, "rooms": 1.0, "area_err": 0.005, "recall": 1.0, "precision": 1.0, "kind": 1.0,
           "swing": 1.0, "width_mm": 5, "names": 1.0}     # pre-registered; do not edit after results are known


def names_matched(truth_path, draft_path) -> float:
    """Share of truth rooms whose overlapping draft room carries the same name."""
    tplan, _ = load_plan(truth_path)
    tl = plan2d.build_layout(tplan, sorted(tplan.levels)[0])
    dplan = Plan(json.loads(draft_path.read_text()))
    dl = plan2d.build_layout(dplan, "L00")
    ok = 0
    for rid, reg in tl.room_regions.items():
        best = max(dl.room_regions.items(), key=lambda kv: reg.intersection(kv[1]).area, default=(None, None))
        if best[0] and dplan.rooms[best[0]]["name"].lower() == tplan.rooms[rid]["name"].lower():
            ok += 1
    return ok / len(tl.room_regions)


def verdict(m: dict) -> dict:
    t = TARGETS
    checks = {
        "offset": m["offset_mm"] <= t["offset_mm"], "rooms": m["rooms"] >= t["rooms"],
        "area": m["area_err_max"] is not None and m["area_err_max"] <= t["area_err"],
        "recall": m["recall"] >= t["recall"], "precision": m["precision"] >= t["precision"],
        "kind": m["kind"] >= t["kind"], "swing": m["swing"] is None or m["swing"] >= t["swing"],
        "width": m["width_err_mm"] <= t["width_mm"], "names": m["names"] >= t["names"],
        "builds": m["builds_without_fail"],
    }
    return {"pass": all(checks.values()), "missed": [k for k, ok in checks.items() if not ok]}


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    plans, out_name = (HOLDOUT, "holdout.json") if "--holdout" in argv else (DEV, "results.json")
    styles = EXPLORE if "--explore" in argv else STYLES
    if "--explore" in argv:
        plans, out_name = DEV + HOLDOUT, "explore.json"
    OUT.mkdir(parents=True, exist_ok=True)
    results = {}
    for p in plans:
        truth = ROOT / "projects" / p / "plan.json"
        for style in styles:
            dxf = OUT / f"{p}_{style}.dxf"
            write(truth, dxf, style)
            draft_dir = OUT / f"{p}_{style}"
            res = read_dxf(dxf, draft_dir)
            m = score(truth, draft_dir / "plan.json")
            m["names"] = names_matched(truth, draft_dir / "plan.json")
            m["reader"] = res.stats
            m["verdict"] = verdict(m)
            results[f"{p}/{style}"] = m
    (OUT / out_name).write_text(json.dumps(results, indent=2, default=float))
    print(f"{'run':14} {'offset':>7} {'rooms':>5} {'area%':>6} {'rec':>5} {'prec':>5} {'kind':>5} "
          f"{'swing':>5} {'width':>6} {'names':>5}  verdict")
    for k, m in results.items():
        print(f"{k:14} {m['offset_mm']:7.2f} {m['rooms']:5.2f} {100 * (m['area_err_max'] or 0):6.2f} "
              f"{m['recall']:5.2f} {m['precision']:5.2f} {m['kind']:5.2f} {m['swing'] or 0:5.2f} "
              f"{m['width_err_mm']:6.1f} {m['names']:5.2f}  "
              f"{'PASS' if m['verdict']['pass'] else 'MISS ' + ','.join(m['verdict']['missed'])}")
    return 0 if all(m["verdict"]["pass"] for m in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
