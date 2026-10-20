# Deliverables (generated, committed for the founder's Unreal PC)

Built by plan3d from `projects/<id>/plan.json`. Do not edit by hand;
regenerate with:

```bash
python -m plan3d build projects/t01/plan.json -o out/t01 --fbx
cp out/t01/unreal/* deliverables/unreal/T01/
```

| Folder | Contents | Built from |
|---|---|---|
| `unreal/T01/` | `T01.fbx` (45 meshes, cm), `import_plan3d.py`, `rooms.csv`, `unreal_manifest.json` | commit b70b3d7, QA 0 FAIL (QR-006) |

Import in Unreal 5.8 (Python plugin on):
`py "<repo>/deliverables/unreal/T01/import_plan3d.py"`
