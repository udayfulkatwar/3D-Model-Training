# Deliverables (generated, committed for the founder's Unreal PC)

Built by plan3d from `projects/<id>/plan.json`. Do not edit by hand;
regenerate with:

```bash
python -m plan3d build projects/t01/plan.json -o out/t01 --fbx
cp out/t01/unreal/* deliverables/unreal/T01/
```

| Folder | Contents | Built from |
|---|---|---|
| `unreal/T01/` | `T01.fbx` (45 meshes, cm), `import_plan3d.py`, `walk_test.py`, `rooms.csv`, `unreal_manifest.json` (26 walk-test lines, 8 clear widths) | plan3d with Q19/Q20, QA 0 FAIL (QR-006, QR-007, QR-008) |
| `unreal/T06/` | `T06.fbx` (52 meshes: two storeys, dog-leg stair, guard rails, balustrades; cm), same scripts, `unreal_manifest.json` (37 walk-test lines incl. stair and guard lines, 5 clear widths) | plan3d with Q19–Q22, QA 0 FAIL (QR-008); **not yet in Unreal** |

The import script opens or creates the level `/Game/<project>_House`
(`T01_House`, `T06_House`) so houses never share a level, and stops if the
open level has unsaved changes.

The PC has no GitHub sign-in. Without one, download a folder from the
private repository in a signed-in browser (GitHub → this branch →
`deliverables/unreal/T06` → download) into `C:\Work\AstraTraining\`.

Import in Unreal 5.8 (Python plugin on):
`py "<repo>/deliverables/unreal/T01/import_plan3d.py"`, then
`py "<repo>/deliverables/unreal/T01/walk_test.py"` (writes `walk_test_results.json`)
