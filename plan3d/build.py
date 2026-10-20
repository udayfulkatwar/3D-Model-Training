"""Pipeline: plan.json -> layout -> solids -> GLB + reports, with QA gates."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from . import __version__, plan2d, qa, reports
from .mesh3d import build_parts, export_scene
from .model import load_plan


@dataclass
class BuildResult:
    report: qa.Report
    out_dir: Path
    outputs: list[Path] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.report.failed


def build(plan_path: str | Path, out_dir: str | Path, fbx: bool = False) -> BuildResult:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = qa.Report()
    result = BuildResult(report, out_dir)

    plan, errors = load_plan(plan_path)
    qa.check_schema(report, errors)
    if plan is None or not qa.check_references(report, plan):
        return _finish(result, plan)

    layouts = {lid: plan2d.build_layout(plan, lid) for lid in sorted(plan.levels)}
    qa.check_provenance(report, plan)
    qa.check_walls(report, plan, layouts)
    qa.check_envelope_and_rooms(report, plan, layouts)
    qa.check_openings(report, plan, layouts)
    qa.check_dimensions(report, plan, layouts)
    qa.check_circulation(report, plan, layouts)
    qa.check_door_swing(report, plan, layouts)
    qa.check_daylight(report, plan, layouts)
    result.outputs.append(reports.write_drawings(plan, layouts, out_dir))

    if any(report.get(cid).status == "FAIL" for cid in ("Q04", "Q05", "Q06", "Q07")):
        return _finish(result, plan, layouts)   # geometry is not trustworthy enough to build

    parts = build_parts(plan, layouts)
    qa.check_solids(report, parts)
    qa.check_degenerate(report, parts)
    qa.check_coplanar(report, parts)
    qa.check_floor_areas(report, plan, parts, layouts)
    qa.check_walk_tests(report, plan, layouts, parts)
    scene = export_scene(parts)
    qa.check_uvs(report, scene)

    glb = out_dir / "model.glb"
    glb.write_bytes(scene.export(file_type="glb"))
    qa.check_glb_roundtrip(report, glb, parts)
    result.outputs += [glb, reports.write_manifest(plan, layouts, parts, out_dir, __version__)]
    if fbx:
        from . import export_fbx
        if export_fbx.bpy_available():
            result.outputs += export_fbx.export(plan, parts, layouts, out_dir, report)
        else:
            report.new("Q17", "FBX re-import matches what was built").add(
                "FAIL", "FBX requested but Blender's Python module is not installed "
                        "(pip install -r requirements-fbx.txt)")
    return _finish(result, plan, layouts)


def _finish(result: BuildResult, plan, layouts=None) -> BuildResult:
    out = result.out_dir
    (out / "qa_report.json").write_text(json.dumps(result.report.to_dict(), indent=2))
    result.outputs.append(out / "qa_report.json")
    result.outputs.append(reports.write_qa_markdown(result.report, plan, out))
    if plan is not None and layouts is not None:
        result.outputs += reports.write_room_schedule(plan, layouts, out)
        result.outputs.append(reports.write_uncertainty(plan, out))
    return result
