"""Walk test in the open Unreal level: the Q19 probe lines, traced against
Unreal's own collision after import_plan3d.py has run.

Every door and arch line must pass freely; every wall and window line must
be blocked, and by the same mesh plan3d expects (expect_mesh in the
manifest). Then each door's clear width (Q20) is checked with sphere
sweeps: 2 cm narrower than the gap must pass, 2 cm wider must be blocked;
and whether Unreal's DefaultPawn (radius 35 cm) fits. Results go to walk_test_results.json next to this script and a
one-line summary to the Output Log.

STATUS: line probes verified in UE 5.8.3 on 2026-10-20 (QR-007): 26/26 as
expected, 26/26 hit the same mesh as plan3d. Clear-width sweeps (Q20) added
afterwards, not yet run in Unreal.

Usage (Unreal Editor, Python plugin enabled, level with the house open):
  py "C:/path/to/unreal/walk_test.py"
"""

import json
import os

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = json.load(open(os.path.join(HERE, "unreal_manifest.json")))
FOLDER = f"Plan3D/{MANIFEST['project']}"
DEFAULT_PAWN_RADIUS_CM = 35.0     # ADefaultPawn sphere, the Play-mode body of a blank project


def first_hit_actor(world, start, end):
    """Label of the first actor the line start->end hits (complex collision), or None."""
    hit = unreal.SystemLibrary.line_trace_single(
        world, unreal.Vector(*start), unreal.Vector(*end),
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1,          # Visibility (5.8 warns: deprecated name)
        True, [], unreal.DrawDebugTrace.NONE, True)
    if isinstance(hit, tuple) and hit and isinstance(hit[0], bool):   # older (bool, HitResult) form
        hit = hit[1] if hit[0] else None
    if hit is None:
        return None
    fields = hit.to_tuple()  # (blocking_hit, ..., hit_actor, hit_component, ...); no break_hit_result in 5.8 Python
    if not fields[0]:
        return None
    actor = next((f for f in fields if isinstance(f, unreal.Actor)), None)
    if actor is None:                                     # fall back to the component's owner
        comp = next((f for f in fields if isinstance(f, unreal.ActorComponent)), None)
        actor = comp.get_owner() if comp else None
    return actor.get_actor_label() if actor else "<unknown actor>"


def sphere_blocked(world, start, end, radius):
    """True if a sphere of radius (cm) swept start->end hits anything."""
    hit = unreal.SystemLibrary.sphere_trace_single(
        world, unreal.Vector(*start), unreal.Vector(*end), radius,
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, [], unreal.DrawDebugTrace.NONE, True)
    if isinstance(hit, tuple) and hit and isinstance(hit[0], bool):
        return hit[0]
    return hit is not None and bool(hit.to_tuple()[0])


def check_clearances(world):
    out = []
    for c in MANIFEST.get("clearances", []):
        half = c["clear_cm"] / 2
        narrower = sphere_blocked(world, c["start_cm"], c["end_cm"], half - 2)
        wider = sphere_blocked(world, c["start_cm"], c["end_cm"], half + 2)
        pawn = sphere_blocked(world, c["start_cm"], c["end_cm"], DEFAULT_PAWN_RADIUS_CM)
        out.append({"name": c["name"], "clear_cm": c["clear_cm"],
                    "narrower_passes": not narrower, "wider_blocked": wider,
                    "ok": (not narrower) and wider, "default_pawn_passes": not pawn})
    return out


def main():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    placed = {a.get_actor_label() for a in actors if str(a.get_folder_path()) == FOLDER}
    missing = sorted(set(MANIFEST["meshes"]) - placed)
    results = []
    for t in MANIFEST["walk_tests"]:
        label = first_hit_actor(world, t["start_cm"], t["end_cm"])
        blocked = label is not None
        results.append({"name": t["name"], "kind": t["kind"], "expect_hit": t["expect_hit"],
                        "expect_mesh": t["expect_mesh"], "hit": label,
                        "ok": blocked == t["expect_hit"],
                        "same_mesh": label == t["expect_mesh"]})
    ok = sum(r["ok"] for r in results)
    same = sum(r["same_mesh"] for r in results)
    clear = check_clearances(world)
    clear_ok = sum(c["ok"] for c in clear)
    summary = {"project": MANIFEST["project"], "level": world.get_path_name(),
               "missing_meshes": missing, "probes": len(results), "as_expected": ok,
               "same_mesh_as_plan3d": same,
               "failures": [r for r in results if not r["ok"]], "results": results,
               "clearances_as_expected": clear_ok, "clearances": clear}
    with open(os.path.join(HERE, "walk_test_results.json"), "w") as f:
        json.dump(summary, f, indent=2)
    line = (f"plan3d walk test: {ok}/{len(results)} probes as expected, {same}/{len(results)} hit the "
            f"same mesh as plan3d, {len(missing)} meshes missing; clear widths {clear_ok}/{len(clear)} "
            f"within 2 cm; DefaultPawn passes {sum(c['default_pawn_passes'] for c in clear)}/{len(clear)}")
    good = ok == len(results) and not missing and clear_ok == len(clear)
    (unreal.log if good else unreal.log_warning)(line)
    for r in summary["failures"]:
        unreal.log_warning(f"plan3d walk test FAIL {r['name']}: expected "
                           f"{'blocked' if r['expect_hit'] else 'clear'}, hit {r['hit']}")


main()
