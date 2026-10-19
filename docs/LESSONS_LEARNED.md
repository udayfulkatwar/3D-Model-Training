# Lessons Learned

Each lesson has an ID, source and review status. Lessons recorded from earlier
sessions are `[reported]` until reproduced in this repository. When one is
reproduced here, mark it `[verified]` with a link to the evidence.

| ID | Date | Area | Lesson | Corrective rule | Source / status |
|---|---|---|---|---|---|
| L-001 | 2026-10-19 | Export | Meshes exported without UVs broke textures downstream | Every face gets a UV map; QA checks it | Township 01 v1 audit `[reported]` |
| L-002 | 2026-10-19 | Geometry | Coplanar overlapping faces render black in Cycles and flicker in real time | Offset ≥ 0.1 m or split; check in QA | `[reported]` |
| L-003 | 2026-10-19 | Geometry | Sunken features hidden under an unbroken ground plane | Cut holes in ground for pools/ramps | `[reported]` |
| L-004 | 2026-10-19 | GIS | OSM polygons triangulate into collinear slivers (zero-area faces in GLB) | Triangulate ourselves; delete faces < 1e-5 m²; simplify roads 0.05 m | `[reported]` |
| L-005 | 2026-10-19 | Plan fidelity | Stair windows were placed over lift shafts | Cross-check every element against the plan drawing by overlay | Township 01 v2 review `[reported]` |
| L-006 | 2026-10-19 | Areas | Typed-in areas can disagree with the model | Compute areas from geometry only | `[reported]` |
| L-007 | 2026-10-19 | Unreal | Blender +Y (north) may arrive as −Y | Check orientation on first import with a north marker | `[reported]` |
| L-008 | 2026-10-19 | Viewer | Flat pick volumes sit inside walls and are hidden | Draw as overlay (depthTest off, low opacity), dim the rest | `[reported]` |
| L-009 | 2026-10-19 | Environment | Terrain plane too small reads as sea on the horizon | Extend land to ≈ ±2.5 km | `[reported]` |
| L-010 | 2026-10-19 | Licensing | Practice models were built from third-party drawings without permission | Only owned designs become showpieces; log permission per drawing | `[reported]` |
| L-011 | 2026-10-19 | Cloud | New AWS accounts have 0 GPU vCPU quota | Request quota days before need | `[reported]` |
