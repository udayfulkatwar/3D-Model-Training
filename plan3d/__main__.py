"""CLI: python -m plan3d build <plan.json> -o <out_dir> | read <image> ... | read-dxf <file.dxf> ..."""

from __future__ import annotations

import argparse
import sys

from .build import build


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="plan3d")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="validate a plan, generate the model and reports")
    b.add_argument("plan")
    b.add_argument("-o", "--out", required=True)
    b.add_argument("--fbx", action="store_true", help="also export FBX + Unreal import bundle (needs bpy)")
    r = sub.add_parser("read", help="read a floor-plan image into a draft plan.json for review")
    r.add_argument("image")
    r.add_argument("-o", "--out", required=True)
    scale = r.add_mutually_exclusive_group(required=True)
    scale.add_argument("--known-width", type=float, help="overall external east-west length in metres")
    scale.add_argument("--px-per-m", type=float)
    r.add_argument("--build", action="store_true", help="also build the draft with plan3d")
    r.add_argument("--fbx", action="store_true", help="with --build, also export FBX for Unreal")
    d = sub.add_parser("read-dxf", help="read an AutoCAD DXF floor plan into a draft plan.json for review")
    d.add_argument("dxf")
    d.add_argument("-o", "--out", required=True)
    d.add_argument("--unit-m", type=float, help="metres per drawing unit, if the DXF does not state its units")
    d.add_argument("--wall-layers", help="regular expression for the wall layers (default: names containing WALL)")
    d.add_argument("--build", action="store_true", help="also build the draft with plan3d")
    d.add_argument("--fbx", action="store_true", help="with --build, also export FBX for Unreal")
    args = ap.parse_args(argv)

    if args.cmd == "read-dxf":
        from .read_dxf import read_dxf
        res = read_dxf(args.dxf, args.out, args.unit_m, args.wall_layers)
        print(f"{res.stats['walls']} walls, {res.stats['openings']} openings, {res.stats['rooms']} rooms "
              f"({res.stats['rooms_named']} named); units {res.stats['unit_m']} m")
        print(f"review: {args.out}/review.md  overlay: {args.out}/overlay.png  draft: {args.out}/plan.json")
        if not args.build:
            return 0
        args.plan = f"{args.out}/plan.json"
        args.out = f"{args.out}/build"

    if args.cmd == "read":
        from .read_raster import read_plan
        res = read_plan(args.image, args.out, args.known_width, args.px_per_m)
        print(f"{res.stats['walls']} walls, {res.stats['openings']} openings, {res.stats['rooms']} rooms; "
              f"skew {res.stats['skew_deg']} deg; {res.stats['px_per_m']} px/m")
        print(f"review: {args.out}/review.md  overlay: {args.out}/overlay.png  draft: {args.out}/plan.json")
        if not args.build:
            return 0
        args.plan = f"{args.out}/plan.json"
        args.out = f"{args.out}/build"

    result = build(args.plan, args.out, fbx=args.fbx)
    c = result.report.counts()
    for check in result.report.checks:
        print(f"{check.id} {check.status:4} {check.name}")
        for d in check.details:
            if not d.startswith("[INFO]"):
                print(f"         {d}")
    print(f"\nPASS {c['PASS']}  INFO {c['INFO']}  WARN {c['WARN']}  FAIL {c['FAIL']}")
    print("outputs:", *[str(p) for p in result.outputs], sep="\n  ")
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
