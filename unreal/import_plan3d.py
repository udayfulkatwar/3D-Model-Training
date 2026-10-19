"""Import a plan3d FBX into the open Unreal Engine level.

STATUS: UNTESTED IN UNREAL. Written against the Unreal Editor Python API
(UE 5.x); it has not been run, because the training environment cannot
run Unreal. Check every step on first use and report what differs.

Usage (Unreal Editor, Python plugin enabled):
  1. Copy this whole folder (FBX, unreal_manifest.json, rooms.csv, this script)
     to the Windows machine.
  2. Output Log -> Python:  py "C:/path/to/unreal/import_plan3d.py"
  3. Check: the house is 12.0 m wide for T01 (1200 uu); NorthMarker sits on
     the north side of the building; you can walk through doors in PIE.
"""

import json
import os

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = json.load(open(os.path.join(HERE, "unreal_manifest.json")))
DEST = f"/Game/Plan3D/{MANIFEST['project']}"
ADD_BASIC_LIGHTING = True       # sun, sky light, atmosphere for a first look


def import_fbx():
    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_textures", False)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    sm = options.static_mesh_import_data
    sm.set_editor_property("combine_meshes", False)               # one asset per part
    sm.set_editor_property("auto_generate_collision", False)      # complex collision set below
    sm.set_editor_property("generate_lightmap_u_vs", True)
    sm.set_editor_property("convert_scene", True)
    sm.set_editor_property("convert_scene_unit", False)           # FBX already in cm (UnitScaleFactor 1)
    sm.set_editor_property("transform_vertex_to_absolute", True)  # keep shared plan origin

    task = unreal.AssetImportTask()
    task.set_editor_property("filename", os.path.join(HERE, MANIFEST["fbx"]))
    task.set_editor_property("destination_path", DEST)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    task.set_editor_property("options", options)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return [p for p in task.get_editor_property("imported_object_paths")]


def walkable_collision(mesh):
    """Use the render mesh as collision so doorways stay open."""
    body = mesh.get_editor_property("body_setup")
    if body:
        body.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
    unreal.EditorAssetLibrary.save_loaded_asset(mesh)


def spawn(actors, what, loc, label, rot=None):
    """Spawn an asset (static mesh) or an actor class at loc (cm)."""
    rot = rot or unreal.Rotator(0, 0, 0)             # Rotator(roll, pitch, yaw)
    if isinstance(what, type):
        a = actors.spawn_actor_from_class(what, unreal.Vector(*loc), rot)
    else:
        a = actors.spawn_actor_from_object(what, unreal.Vector(*loc), rot)
    a.set_actor_label(label)
    a.set_folder_path(f"Plan3D/{MANIFEST['project']}")
    return a


def main():
    imported = import_fbx()
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    found = 0
    for name in MANIFEST["meshes"]:
        mesh = unreal.EditorAssetLibrary.load_asset(f"{DEST}/{name}")
        if mesh is None:
            unreal.log_warning(f"plan3d: {name} was not imported")
            continue
        walkable_collision(mesh)
        spawn(actors, mesh, (0, 0, 0), name)
        found += 1
    spawn(actors, unreal.PlayerStart, MANIFEST["player_start_cm"], "PlayerStart_Plan3D")
    marker = spawn(actors, unreal.TextRenderActor, MANIFEST["north_marker_cm"], "NorthMarker")
    text = marker.get_component_by_class(unreal.TextRenderComponent)
    if text:
        text.set_text("N (plan +Y)")
    else:
        unreal.log_warning("plan3d: could not label NorthMarker; it is the TextRenderActor at north_marker_cm")
    if ADD_BASIC_LIGHTING:
        spawn(actors, unreal.DirectionalLight, (0, 0, 1000), "Sun", unreal.Rotator(0, -40, 135))
        spawn(actors, unreal.SkyLight, (0, 0, 1000), "SkyLight")
        spawn(actors, unreal.SkyAtmosphere, (0, 0, 0), "SkyAtmosphere")
    unreal.log(f"plan3d: imported {len(imported)} assets, spawned {found}/{len(MANIFEST['meshes'])} meshes "
               f"into {DEST}. Rooms DataTable source: rooms.csv (struct S_RoomData).")


main()
