"""CLI: python -m plan3d build <plan.json> -o <out_dir>"""

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
    args = ap.parse_args(argv)

    result = build(args.plan, args.out)
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
