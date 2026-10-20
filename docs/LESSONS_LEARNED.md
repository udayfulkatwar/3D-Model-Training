# Lessons Learned

Each lesson has an ID, source and review status. Lessons recorded from earlier
sessions are `[reported]` until reproduced in this repository. When one is
reproduced here, mark it `[verified]` with a link to the evidence.

| ID | Date | Area | Lesson | Corrective rule | Source / status |
|---|---|---|---|---|---|
| L-001 | 2026-10-19 | Export | Meshes exported without UVs broke textures downstream | Every face gets a UV map; QA checks it | Township 01 v1 audit `[reported]`; check Q15 + GLB round trip `[verified 2026-10-19]` |
| L-002 | 2026-10-19 | Geometry | Coplanar overlapping faces render black in Cycles and flicker in real time | Offset ≥ 0.1 m or split; check in QA | `[reported]`; detection by Q13 `[verified 2026-10-19]` |
| L-003 | 2026-10-19 | Geometry | Sunken features hidden under an unbroken ground plane | Cut holes in ground for pools/ramps | `[reported]` |
| L-004 | 2026-10-19 | GIS | OSM polygons triangulate into collinear slivers (zero-area faces in GLB) | Triangulate ourselves; delete faces < 1e-5 m²; simplify roads 0.05 m | Reproduced in plan3d with grid-snapped walls `[verified 2026-10-19]` |
| L-005 | 2026-10-19 | Plan fidelity | Stair windows were placed over lift shafts | Cross-check every element against the plan drawing by overlay | Township 01 v2 review `[reported]`; confirmed by L-016 |
| L-006 | 2026-10-19 | Areas | Typed-in areas can disagree with the model | Compute areas from geometry only | plan3d derives rooms from walls; Q08/Q14 `[verified 2026-10-19]` |
| L-007 | 2026-10-19 | Unreal | Blender +Y (north) may arrive as −Y | Check orientation on first import with a north marker | Confirmed in UE 5.8: plan +Y → Unreal −Y `[verified 2026-10-20]` QR-005 |
| L-008 | 2026-10-19 | Viewer | Flat pick volumes sit inside walls and are hidden | Draw as overlay (depthTest off, low opacity), dim the rest | `[reported]` |
| L-009 | 2026-10-19 | Environment | Terrain plane too small reads as sea on the horizon | Extend land to ≈ ±2.5 km | `[reported]` |
| L-010 | 2026-10-19 | Licensing | Practice models were built from third-party drawings without permission | Only owned designs become showpieces; log permission per drawing | `[reported]` |
| L-011 | 2026-10-19 | Cloud | New AWS accounts have 0 GPU vCPU quota | Request quota days before need | `[reported]` |
| L-012 | 2026-10-19 | Geometry | Extending walls by half the other wall's thickness closes joints only at 90°; at 135° it left a spike and notches | Mitred joints from face-line intersections; test joints at several angles | `[verified 2026-10-19]` QR-002 |
| L-013 | 2026-10-19 | Formats | glTF stores positions as float32: the GLB volume differed from the exact solid by 2.2e-5 m³ | Measure from the float64 model; test GLBs at float32 tolerance; keep origin near the site | `[verified 2026-10-19]` QR-002 |
| L-014 | 2026-10-19 | Testing | A plan authored together with its register passes by construction. A pass proves nothing until each check has been seen failing | Mutation tests for every check; independent hand arithmetic for areas and volumes | `[verified 2026-10-19]` QR-002 |
| L-015 | 2026-10-19 | Testing | A failing test was a test-helper bug (removing a door left an empty schema list), not a product bug | Read the failure before "fixing" code | `[verified 2026-10-19]` |
| L-017 | 2026-10-19 | Image processing | OpenCV anchors even-sized kernels off-centre: masks shift 1–2 px, which cost 4 mm of accuracy everywhere unnoticed | Always use odd morphology kernels (`_odd`) | `[verified 2026-10-19]` QR-003 |
| L-018 | 2026-10-19 | Image processing | Local gradient directions cannot measure small skew: a rotated edge is a pixel staircase | Use a global method (projection profile) | `[verified 2026-10-19]` QR-003 |
| L-019 | 2026-10-19 | Algorithms | Grouping by one coordinate without the orientation merged a horizontal and a vertical wall whose pixel positions happened to match | Key every grouping by all identifying attributes | `[verified 2026-10-19]` QR-003 |
| L-020 | 2026-10-19 | Method | Dev results (6/6) overstated holdout results (2/3). An unseen style exposed two bugs no dev case could | Pre-register targets; keep holdouts frozen; report every run in order; mark tuned-on results as such | `[verified 2026-10-19]` QR-003 |
| L-021 | 2026-10-19 | Licensing | `pip install pymupdf` pulled in an AGPL library, unsuitable for commercial tooling | Check the licence of every new dependency; use pypdfium2 (BSD/Apache) | `[verified 2026-10-19]` |
| L-022 | 2026-10-19 | QA | plan3d's own checks caught an error in a hand-authored truth plan (an arch cutting into a wall) before it was used | Validate test data with the same QA as production data | `[verified 2026-10-19]` |
| L-023 | 2026-10-19 | Formats | Blender's "FBX All" scaling stores metres with UnitScaleFactor 100, not centimetres. Assumed otherwise until the header was read | Read the file header; store Unreal's native cm (UnitScaleFactor 1) and enforce it in QA | `[verified 2026-10-19]` QR-004 |
| L-024 | 2026-10-19 | Verification | Blender writing and Blender checking a file can share one bug | Cross-check with an independent reader (ufbx) | `[verified 2026-10-19]` QR-004 |
| L-025 | 2026-10-19 | Licensing | Blender's Python module is GPL-3.0 | Run it as a separate worker process that exchanges files; get legal review before distributing | `[verified 2026-10-19]` ADR-010 |
| L-026 | 2026-10-20 | Geometry | Unioning boxes whose faces coincide (frame jambs + head) left 6 sliver triangles; Q12 caught it | Build such parts as one 2D profile extruded once; avoid 3D booleans of coincident faces | `[verified 2026-10-20]` QR-006 |
| L-030 | 2026-10-20 | Unreal | Frames and open leaves cut a 0.75 m door to 0.595 m clear, narrower than Unreal's 0.70 m DefaultPawn | Check clear width (Q20) against the walking body, not the structural width; pick the walkthrough pawn size deliberately | `[verified 2026-10-20]` (QR-008), plan3d only |
| L-031 | 2026-10-20 | Process | The PC session's safety check refused a script sent by another session, though the founder had given standing approval | Treat that refusal as final; ask the founder to approve, never route around it. Prefer sending data over code when possible | `[verified 2026-10-20]` (QR-008) |
| L-032 | 2026-10-20 | Reader | Hollow-wall rules passed 6/6 development and 3/4 holdout runs, then failed 4/4 on two new plans: a 0.7 m wall piece fell between the 'long' and 'pier' rules | A size-banded rule set leaves gaps between bands; prefer one rule with one test (continue a wall band). Keep pre-registering holdouts; one holdout is not enough | `[verified 2026-10-20]` (T006_PLAN_READING.md) |
| L-033 | 2026-10-20 | Review | An independent review found 4 real bugs that 91 passing tests missed (float slits in unions, biased width estimates, an uncapped well, a shared 'outside' node) | Ask a separate reviewer to attack new code with its own inputs; build shared geometry in one exact frame instead of unioning floats | `[verified 2026-10-20]` (QR-008 follow-up) |
| L-028 | 2026-10-20 | Unreal | `GameplayStatics.break_hit_result` is not exposed to Python in UE 5.8; `HitResult.to_tuple()` gives the same fields | Check engine Python APIs on the real editor before trusting docs; keep scripts small so the PC session can fix them in one edit | `[verified 2026-10-20]` (QR-007) |
| L-029 | 2026-10-20 | Tooling | trimesh ray casting silently needs `rtree`; a missing optional dependency crashed every build | Prefer a few lines of numpy over an optional dependency for small geometry tests | `[verified 2026-10-20]` (QR-007) |
| L-027 | 2026-10-20 | Unreal | Re-running an import script that only spawns actors stacks duplicate copies (z-fighting) | Import scripts must remove their own previous actors (by folder) first | `[verified 2026-10-20]`: v2 re-run removed 58 old actors, 0 duplicates (QR-007) |
| L-016 | 2026-10-19 | Review | Reviewing the generated plan drawing caught doors swinging out of their rooms; no automated check had flagged it | Always look at the drawing and 3D views (L-005 confirmed); then automate (`opens_into` check) | `[verified 2026-10-19]` |
