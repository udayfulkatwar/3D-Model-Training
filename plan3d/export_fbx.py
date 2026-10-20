"""FBX export for Unreal Engine / Twinmotion, via the Blender worker process.

Writes <out>/unreal/:
  <PROJECT>.fbx            one static mesh per part, pivots at the plan origin
  unreal_manifest.json     asset names, units, axes, room seeds in Unreal cm
  rooms.csv                DataTable-ready room schedule (struct S_RoomData)
  import_plan3d.py         Unreal Editor Python import script (verified in UE 5.8, QR-005/QR-006)
  walk_test.py             traces the Q19 walk-test lines against Unreal's collision
"""

from __future__ import annotations

import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

from . import qa, walktests
from .mesh3d import MATERIALS, Part
from .model import Plan
from .units import sqm_to_sqft

UNREAL_DIR = Path(__file__).resolve().parents[1] / "unreal"
UNREAL_SCRIPTS = ("import_plan3d.py", "walk_test.py")
MATERIAL_NAMES = {"wall": "M_Wall", "floor": "M_Floor", "ceiling": "M_Ceiling", "glass": "M_Glass",
                  "frame": "M_Frame", "door": "M_Door", "stair": "M_Stair"}


def bpy_available() -> bool:
    probe = subprocess.run([sys.executable, "-c", "import bpy"], capture_output=True)
    return probe.returncode == 0


def asset_name(plan: Plan, part: Part) -> str:
    return f"SM_{plan.project['id']}_{part.name}"


def _corner_uvs(solid) -> np.ndarray:
    """Box-projected UVs per face corner (1 UV unit = 1 m), matching the GLB."""
    tris = solid.vertices[solid.faces]
    axis = np.abs(solid.face_normals).argmax(1)
    keep = {0: (1, 2), 1: (0, 2), 2: (0, 1)}
    uv = np.empty((len(tris), 3, 2))
    for ax, cols in keep.items():
        uv[axis == ax] = tris[axis == ax][:, :, cols]
    return uv


def to_unreal_cm(x: float, y: float, z: float) -> list[float]:
    """Plan metres -> Unreal centimetres. Unreal is left-handed: plan +Y
    (north) is expected to arrive as Unreal -Y (lesson L-007). Verify on the
    first import with the north marker in the manifest."""
    return [round(x * 100, 2), round(-y * 100, 2), round(z * 100, 2)]


def export(plan: Plan, parts: list[Part], layouts: dict, out_dir: Path, report: qa.Report) -> list[Path]:
    udir = out_dir / "unreal"
    work = out_dir / "_fbx_work"
    udir.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    fbx = udir / f"{plan.project['id']}.fbx"

    arrays, meta_parts = {}, []
    for p in parts:
        name = asset_name(plan, p)
        arrays[f"{name}:v"] = p.solid.vertices
        arrays[f"{name}:f"] = p.solid.faces
        arrays[f"{name}:uv"] = _corner_uvs(p.solid)
        meta_parts.append({"name": name, "material": MATERIAL_NAMES[p.role]})
    np.savez(work / "parts.npz", **arrays)
    meta = {"parts": meta_parts, "materials": [
        {"name": MATERIAL_NAMES[k], "color": v["baseColorFactor"], "roughness": v["roughnessFactor"]}
        for k, v in MATERIALS.items()]}
    (work / "parts.json").write_text(json.dumps(meta))

    c = report.new("Q17", "FBX re-import matches what was built")
    for step in (["export", str(work / "parts.npz"), str(work / "parts.json"), str(fbx)],
                 ["verify", str(fbx), str(work / "verify.json")]):
        run = subprocess.run([sys.executable, "-m", "plan3d.fbx_worker", *step],
                             capture_output=True, text=True, cwd=Path(__file__).resolve().parents[1])
        if run.returncode != 0:
            c.add("FAIL", f"Blender worker '{step[0]}' failed: {run.stderr.strip().splitlines()[-1:]}")
            return []
    check = json.loads((work / "verify.json").read_text())
    _check_fbx(c, plan, parts, check)
    shutil.rmtree(work)

    paths = [fbx, _write_manifest(plan, parts, layouts, udir, check), _write_rooms(plan, layouts, udir)]
    for script in UNREAL_SCRIPTS:
        if (UNREAL_DIR / script).exists():
            shutil.copy(UNREAL_DIR / script, udir / script)
            paths.append(udir / script)
    return paths


def _check_fbx(c: qa.Check, plan: Plan, parts: list[Part], check: dict) -> None:
    objs = check["objects"]
    expected = {asset_name(plan, p): p for p in parts}
    for name in sorted(set(expected) - set(objs)):
        c.add("FAIL", f"{name}: missing after FBX re-import")
    for name in sorted(set(objs) - set(expected)):
        c.add("FAIL", f"{name}: unexpected object in FBX")
    for name, p in expected.items():
        o = objs.get(name)
        if o is None:
            continue
        if o["triangles"] != len(p.solid.faces) or o["max_polygon_sides"] != 3:
            c.add("FAIL", f"{name}: {o['triangles']} triangles after re-import, built {len(p.solid.faces)}")
        if not (np.allclose(o["bounds"][0], p.solid.bounds[0], atol=1e-4)
                and np.allclose(o["bounds"][1], p.solid.bounds[1], atol=1e-4)):
            c.add("FAIL", f"{name}: bounds {o['bounds']} differ from built {p.solid.bounds.tolist()}")
        if o["uv_layers"] < 1:
            c.add("FAIL", f"{name}: no UVs in FBX")
        if o["materials"] != [MATERIAL_NAMES[p.role]]:
            c.add("FAIL", f"{name}: materials {o['materials']}")
    h = check["header"]
    span_m = max(float(np.abs(p.solid.bounds).max()) for p in parts)
    stored = check["raw_extent"] / span_m if span_m else 0
    # Blender stores the scene scale as float32: 0.01 x 100 arrives as 0.99999998
    if abs(float(h.get("UnitScaleFactor", 0)) - 1.0) > 1e-6 or abs(stored - 100) > 1e-3:
        c.add("FAIL", f"FBX is not in centimetres: UnitScaleFactor={h.get('UnitScaleFactor')}, "
                      f"coordinates stored at {stored:.2f}x metres (need 1.0 and 100x)")
    unit = float(h.get("UnitScaleFactor", 0))
    c.add("INFO", f"FBX header: UnitScaleFactor={unit:.6f} (cm), UpAxis={h.get('UpAxis')}, "
                  f"FrontAxis={h.get('FrontAxis')}; coordinates stored at {stored:.0f}x metres")


def _walk_tests(plan, parts, layouts) -> list[dict]:
    """Q19 probes in Unreal cm, with the mesh each one should hit first
    (None = must pass freely), for unreal/walk_test.py."""
    names = {p.name: asset_name(plan, p) for p in parts}
    out = []
    for t in walktests.run(walktests.generate(plan, layouts), parts):
        hit = t.pop("hit")
        t.pop("ok")
        out.append({**t, "start_cm": to_unreal_cm(*t["start"]), "end_cm": to_unreal_cm(*t["end"]),
                    "expect_mesh": names.get(hit)})
    return out


def _write_manifest(plan, parts, layouts, udir, check) -> Path:
    rooms = []
    for lid, lay in layouts.items():
        z = plan.levels[lid]["elevation"]
        for rid, region in sorted(lay.room_regions.items()):
            p = region.representative_point()
            rooms.append({"RoomID": rid, "Name": plan.rooms[rid]["name"], "Use": plan.rooms[rid]["use"],
                          "Level": lid, "SeedUnrealCm": to_unreal_cm(p.x, p.y, z)})
    start = next((r for r in rooms if r["Use"] == "living"), rooms[0] if rooms else None)
    manifest = {
        "project": plan.project["id"], "fbx": f"{plan.project['id']}.fbx",
        "meshes": [asset_name(plan, p) for p in parts],
        "units": "FBX stores centimetres (UnitScaleFactor 1.0, verified by Q17); 1 m = 100 Unreal units",
        "axes": "Plan +X (east) -> Unreal +X; plan +Y (north) -> Unreal -Y (expected; verify with NorthMarker)",
        "pivot": "All meshes share the plan origin (outer south-west corner); spawn every actor at 0,0,0",
        "player_start_cm": [start["SeedUnrealCm"][0], start["SeedUnrealCm"][1],
                            start["SeedUnrealCm"][2] + 100] if start else [0, 0, 100],
        "north_marker_cm": to_unreal_cm(0.0, 1.0, 0.0),
        "fbx_header": check["header"],
        "rooms": rooms,
        "walk_tests": _walk_tests(plan, parts, layouts),
        "clearances": [{**c, "start_cm": to_unreal_cm(*c["start"]), "end_cm": to_unreal_cm(*c["end"]),
                        "clear_cm": round(c["clear_m"] * 100, 2)}
                       for c in walktests.clearances(plan, layouts, parts)],
        "status": "Imported and read back in UE 5.8 (QR-005, QR-006); see QUALITY_REPORTS.md",
    }
    path = udir / "unreal_manifest.json"
    path.write_text(json.dumps(manifest, indent=2, default=float))
    return path


def _write_rooms(plan, layouts, udir) -> Path:
    path = udir / "rooms.csv"
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["---", "RoomID", "Name", "Use", "Level", "AreaM2", "AreaSqft"])   # first column = row name
        for lid, lay in layouts.items():
            for rid, region in sorted(lay.room_regions.items()):
                w.writerow([rid, rid, plan.rooms[rid]["name"], plan.rooms[rid]["use"], lid,
                            round(region.area, 3), round(sqm_to_sqft(region.area), 1)])
    return path
