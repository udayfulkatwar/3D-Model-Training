"""Walk test in the open Unreal level: the Q19 probe lines, traced against
Unreal's own collision after import_plan3d.py has run.

Every door and arch line must pass freely; every wall and window line must
be blocked, and by the same mesh plan3d expects (expect_mesh in the
manifest). Results go to walk_test_results.json next to this script and a
one-line summary to the Output Log.

STATUS: written 2026-10-20, not yet run in Unreal.

Usage (Unreal Editor, Python plugin enabled, level with the house open):
  py "C:/path/to/unreal/walk_test.py"
"""

import json
import os

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = json.load(open(os.path.join(HERE, "unreal_manifest.json")))
FOLDER = f"Plan3D/{MANIFEST['project']}"


def first_hit_actor(world, start, end):
    """Label of the first actor the line start->end hits (complex collision), or None."""
    hit = unreal.SystemLibrary.line_trace_single(
        world, unreal.Vector(*start), unreal.Vector(*end),
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1,          # Visibility
        True, [], unreal.DrawDebugTrace.NONE, True)
    if isinstance(hit, tuple) and hit and isinstance(hit[0], bool):   # older (bool, HitResult) form
        hit = hit[1] if hit[0] else None
    if hit is None:
        return None
    fields = unreal.GameplayStatics.break_hit_result(hit)  # (blocking_hit, ..., hit_actor, hit_component, ...)
    if not fields[0]:
        return None
    actor = next((f for f in fields if isinstance(f, unreal.Actor)), None)
    if actor is None:                                     # fall back to the component's owner
        comp = next((f for f in fields if isinstance(f, unreal.ActorComponent)), None)
        actor = comp.get_owner() if comp else None
    return actor.get_actor_label() if actor else "<unknown actor>"


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
    summary = {"project": MANIFEST["project"], "level": world.get_path_name(),
               "missing_meshes": missing, "probes": len(results), "as_expected": ok,
               "same_mesh_as_plan3d": same,
               "failures": [r for r in results if not r["ok"]], "results": results}
    with open(os.path.join(HERE, "walk_test_results.json"), "w") as f:
        json.dump(summary, f, indent=2)
    line = (f"plan3d walk test: {ok}/{len(results)} probes as expected, {same}/{len(results)} hit the "
            f"same mesh as plan3d, {len(missing)} meshes missing")
    (unreal.log if ok == len(results) and not missing else unreal.log_warning)(line)
    for r in summary["failures"]:
        unreal.log_warning(f"plan3d walk test FAIL {r['name']}: expected "
                           f"{'blocked' if r['expect_hit'] else 'clear'}, hit {r['hit']}")


main()
