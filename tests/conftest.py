import copy
import json
from pathlib import Path

import pytest

from plan3d.build import build

ROOT = Path(__file__).resolve().parents[1]
T01_PATH = ROOT / "projects" / "t01" / "plan.json"
_T01 = json.loads(T01_PATH.read_text())


@pytest.fixture
def t01():
    """A fresh, mutable copy of the T01 training plan."""
    return copy.deepcopy(_T01)


@pytest.fixture
def run(tmp_path):
    """Build a plan dict; return (result, {check id: status})."""
    counter = iter(range(1000))

    def _run(raw):
        d = tmp_path / f"case{next(counter)}"
        d.mkdir()
        (d / "plan.json").write_text(json.dumps(raw))
        result = build(d / "plan.json", d / "out")
        return result, {c.id: c.status for c in result.report.checks}
    return _run


def item(raw, collection, item_id):
    return next(x for x in raw[collection] if x["id"] == item_id)


def details(result, check_id):
    return "\n".join(result.report.get(check_id).details)


def remove_opening(raw, opening_id):
    """Delete an opening and its register links, dropping dimensions left with no target."""
    raw["openings"] = [o for o in raw["openings"] if o["id"] != opening_id]
    for d in raw["dimensions"]:
        if d["check"]["kind"] == "param":
            d["check"]["targets"] = [t for t in d["check"]["targets"]
                                     if not t.startswith(f"openings.{opening_id}.")]
    raw["dimensions"] = [d for d in raw["dimensions"]
                         if d["check"]["kind"] != "param" or d["check"]["targets"]]
