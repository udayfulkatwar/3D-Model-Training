"""DXF intake (T-016): pre-registered targets on development plans, and the
layer rules that keep clutter out (docs/T016_DXF_INTAKE.md)."""

import ezdxf
import pytest

from bench.dxf_drawing import write
from bench.dxf_run import names_matched, verdict
from bench.run import ROOT, score
from plan3d.read_dxf import read_dxf


def _case(tmp_path, plan_id, style):
    truth = ROOT / "projects" / plan_id / "plan.json"
    write(truth, tmp_path / "plan.dxf", style)
    res = read_dxf(tmp_path / "plan.dxf", tmp_path / "draft")
    m = score(truth, tmp_path / "draft" / "plan.json")
    m["names"] = names_matched(truth, tmp_path / "draft" / "plan.json")
    return res, m


@pytest.mark.parametrize("plan_id,style", [("t01", "lines"), ("t02", "hatched")])
def test_dxf_meets_targets(tmp_path, plan_id, style):
    _, m = _case(tmp_path, plan_id, style)
    v = verdict(m)
    assert v["pass"], (v["missed"], m["missed"], m["spurious"], m["wrong_kind"])


def test_room_names_and_uses_come_from_text(tmp_path):
    res, _ = _case(tmp_path, "t01", "poly")
    uses = {r["name"]: r["use"] for r in res.plan["rooms"]}
    assert uses["Kitchen"] == "kitchen" and uses["Toilet 1"] == "toilet" and uses["Bedroom 1 (master)"] == "bedroom"


def test_furniture_on_a_wall_layer_name_is_still_ignored_unless_named(tmp_path):
    truth = ROOT / "projects" / "t02" / "plan.json"
    write(truth, tmp_path / "plan.dxf", "poly")
    doc = ezdxf.readfile(tmp_path / "plan.dxf")
    for e in doc.modelspace().query('*[layer=="A-WALL"]'):
        e.dxf.layer = "MY-OUTLINES"                     # an office with its own layer names
    doc.saveas(tmp_path / "renamed.dxf")
    with pytest.raises(ValueError, match="no closed wall outlines"):
        read_dxf(tmp_path / "renamed.dxf", tmp_path / "d1")
    res = read_dxf(tmp_path / "renamed.dxf", tmp_path / "d2", wall_layers="OUTLINES")
    assert res.stats["rooms"] == 5


def test_missing_units_must_be_given(tmp_path):
    truth = ROOT / "projects" / "t02" / "plan.json"
    write(truth, tmp_path / "plan.dxf", "poly")
    doc = ezdxf.readfile(tmp_path / "plan.dxf")
    doc.header["$INSUNITS"] = 0
    doc.saveas(tmp_path / "nounits.dxf")
    with pytest.raises(ValueError, match="units"):
        read_dxf(tmp_path / "nounits.dxf", tmp_path / "d1")
    assert read_dxf(tmp_path / "nounits.dxf", tmp_path / "d2", unit_m=0.001).stats["rooms"] == 5


def test_line_ends_that_miss_or_overshoot_still_close(tmp_path):
    for style in ("gappy", "overshoot"):
        _, m = _case(tmp_path / style, "t04", style)
        assert verdict(m)["pass"], (style, m["missed"], m["spurious"])
