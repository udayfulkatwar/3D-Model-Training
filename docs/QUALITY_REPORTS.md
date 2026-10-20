# Quality Reports

Each entry records what was checked, how, the result, and how to reproduce
it. No entry means it was not checked.

---

## QR-001 — Live website stack inspection

- **Date:** 2026-10-19 · **Target:** https://dwell.astragrp.net/ and `/experience`
- **Method:** HTTP fetch of the pages (response headers, DNS) and download of all
  referenced and lazily loaded `/_next/static/chunks/*.js`; text search for
  framework and library signatures.
- **Results:**
  - Served by GitHub Pages (`server: GitHub.com`, Fastly); DNS resolves to
    `udayfulkatwar.github.io` (185.199.108–111.153).
  - Next.js static export built with Turbopack.
  - three.js `REVISION = "186"`; `rendererPackageName: "@react-three/fiber"`,
    `rendererVersion: "9.8.1"`.
  - GLTFLoader, DRACOLoader, KTX2Loader, PMREMGenerator and RectAreaLight
    referenced in the 3D chunk.
  - 3D code chunk: 1,056,653 bytes raw, ~286,701 bytes gzip (excludes model data).
- **Not checked:** runtime behaviour, model payload size, frame rate, mobile
  devices, accessibility, Lighthouse scores.
- **Reproduce:**
  ```bash
  curl -sSI https://dwell.astragrp.net/ | grep -i server
  # then fetch chunk URLs found in the HTML and grep for 'REVISION' and 'rendererVersion'
  ```

---

## QR-002: plan3d v0.1 on Training House T01

- **Date:** 2026-10-19 · **Scope:** T-001, training repo only
- **Environment:** Python 3.13.16, pinned `requirements.txt`; Node 22.22.0;
  three.js 0.186.0; Chromium 141.0.7390.37 with SwiftShader (software GL).
- **Inputs:** `projects/t01/plan.json` (file SHA-256 `0bc66eaf…ac76f8`).
  T01 is fictional: its geometry and register were authored together, so its
  own conformance pass is expected. The evidence that the checks work is
  the mutation tests below.
- **Evidence:** [docs/evidence/QR-002/](evidence/QR-002/)

### Results

| Test | Result |
|---|---|
| Unit/integration tests (`pytest`) | **38 passed**, 0 failed ([list](evidence/QR-002/pytest.txt)) |
| T01 build QA | PASS 12 · INFO 2 · WARN 2 · FAIL 0 ([report](evidence/QR-002/qa_report.md)) |
| Expected warnings only | OPEN D-090 (plinth), OPEN D-091 (parapet), R06 Toilet 2 internal (needs mechanical ventilation) |
| Room sizes vs independent hand arithmetic | All 8 rooms within 0.1 mm; areas within 0.001 m² |
| Wall volume vs analytic (built-up − carpet) × height − voids | Built solid within 1e-6 m³ (42.059726 m³); GLB within 1e-4 m³ (float32) |
| Mutation tests: each check fails on its defect | Q01, Q02, Q03, Q04, Q05, Q06, Q07 (×5 defects), Q08 (×4 incl. ±5 mm tolerance boundary), Q09 (×2), Q10, Q12, Q13 all observed failing/warning as designed |
| Wall joints at 60°, 90°, 120°, 135° and reflex corners | Mean edge offset < 0.01 mm vs exact mitred offset polygons |
| Determinism | Two builds produce byte-identical GLB (SHA-256 `0174c8b0…a37e3`) |
| three.js r186 load in Chromium | 24/24 meshes, triangle counts, UVs, materials, transparency and axes match manifest; 0 console errors ([json](evidence/QR-002/browser_check.json)) |
| Visual review of plan drawing and two 3D views | Layout, openings and door swings match intent ([plan](evidence/QR-002/plan_L00.png), [dollhouse](evidence/QR-002/browser_dollhouse.png), [exterior](evidence/QR-002/browser_exterior.png)) |

Carpet area 105.862 m² (1,139.5 sq ft) on a 120 m² built-up footprint.

### Defects found during development (all fixed and covered by tests)

1. Joint extension was exact only at 90°; a 135° chamfer left a spike and
   notches (0.0069 m² error). Replaced by a mitred joint algorithm.
2. Grid-snapped irrational coordinates left near-collinear vertices that
   triangulated into 16 sliver faces (reproduces L-004). Vertices within
   0.01 mm of collinear are now removed.
3. Door swings were drawn on an arbitrary side (two doors swung out of their
   rooms). Added `opens_into` with validation.
4. A level without walls crashed the drawing step. It now FAILs cleanly.
5. glTF positions are float32: GLB volume differs from the float64 solid by
   2.2e-5 m³. Format precision rather than a defect; tests use the right tolerance.

### Not verified

- Frame rate or load time on any real phone or GPU (software rendering only).
- Use on a real client drawing; opening positions against a drawing.
- Multi-level buildings (warned, unverified), Unreal/Twinmotion import.

---

## QR-003: plan reader v0.1 (T-006)

- **Date:** 2026-10-19 · **Scope:** training repo only
- **Method and targets:** [T006_PLAN_READING.md](T006_PLAN_READING.md),
  pre-registered in commit `8baef24` before the reader existed.
- **Evidence:** [docs/evidence/QR-003/](evidence/QR-003/): every run's
  metrics as JSON, plus the overlay, drawing and review sheet for the
  hardest holdout run.

### Summary

| Stage | Result |
|---|---|
| Development, first run | 1/6 runs met all targets |
| Holdout 1 (T03), first run | 2/3 (one arch read as a window at 60 px/m; the draft failed QA, so it was not silently accepted) |
| After post-holdout fixes | 18/18 dev, T03 and exploratory runs (tuned on these; not unseen) |
| **Holdout 2 (T04), first run** | **2/2**: 15/15 openings, 6/6 rooms, correct kinds and swings; wall offset 1.7–3.2 mm; area error ≤ 0.93% |
| Regression tests | 47 tests pass (5 hardest reading cases included) |

### Defects found and fixed (each now covered by a test or benchmark case)

1. Gradient-histogram deskew could not see a 1.5° rotation (staircase
   edges). Replaced by projection-profile search.
2. Horizontal and vertical walls were grouped together when their pixel
   positions coincided (north wall merged into west wall).
3. Wall nibs shorter than the run-length kernel were dropped, merging
   two openings into one false arch. Fixed with a second pass along known wall lines.
4. Short walls (a 1.4 m wall made only of nibs) were lost. They are now
   recovered from leftover wall pixels.
5. The connectivity filter used a stricter reach than end snapping, so it dropped valid walls.
6. Fixed 4 px gap bridging read a dashed arch as glazing. Bridging now
   matches the pen width.
7. **Even-sized morphology kernels shifted masks by 1–2 px** (OpenCV
   anchor). Fixing this cut T01 wall offset from 5.0 to 1.15 mm.
8. A fixed 2.5× pen-width cutoff deleted 100 mm walls under a thick pen.
   The cutoff is now an Otsu split of the stroke-width histogram.
9. plan3d crashed when a door had no interior side. It now reports this.

### Not verified (QR-003)

- **Any real drawing.** All test drawings come from one synthetic
  renderer (see "What this does and does not show" in T006_PLAN_READING.md).
- Text reading (room names, dimensions): there is no OCR.
- Hollow/hatched walls, curved or diagonal walls, perspective photos, PDFs with vector content.

---

## QR-004: FBX export for Unreal (T-009)

- **Date:** 2026-10-19 · **Scope:** training repo only
- **Environment:** Blender 5.2.2 LTS Python module (bpy) in a separate
  worker process; ufbx 0.0.5 as an independent reader.
- **Evidence:** [docs/evidence/QR-004/](evidence/QR-004/)

### Results

| Check | Result |
|---|---|
| T01–T04 build with `--fbx` | All four: 0 FAIL, Q17 passes |
| Blender re-import (Q17) | 24/24 meshes on T01; names, triangle counts, UVs, materials equal; sizes within 0.1 mm |
| Units in the FBX header | UnitScaleFactor 1.000000 (cm); coordinates stored at 100× metres |
| Independent read (ufbx) | 24/24 meshes, unit 0.01 m, bounds exact to 0.000 cm, triangles equal, UVs present |
| North direction in a left-handed Z-up conversion (ufbx) | Plan north arrives at −Y (Bedroom 1: y −977 to −506 cm), as the Unreal script expects |
| Tests | 55 pass, 8 of them FBX tests (including mutation tests that a metres-scaled FBX or a missing mesh fails Q17) |

### Defects found during development

1. **Wrong unit assumption, caught before release.** Blender's
   "FBX All" scaling writes metres with UnitScaleFactor 100, not
   centimetres. Whether Unreal sizes that correctly depends on an import
   option. The export now stores centimetres outright, and Q17 fails
   any other unit.
2. Blender writes the unit factor as float32 (0.99999998). The check
   uses a 1e-6 tolerance instead of exact equality.

### Not verified

- **Nothing has been imported into Unreal Engine or Twinmotion.** The
  Unreal script is written against the documented API but has never run.
  Axis mapping, collision setup, PlayerStart placement and material
  import all need the founder's first-import check (PLAN3D.md).
- ufbx's left-handed Z-up conversion models Unreal's axes; it is not
  Unreal's importer.

---

## QR-005: first import into real Unreal Engine (T-012, partial)

- **Date:** 2026-10-20 · **Where:** founder's Windows PC, Unreal Engine 5.8,
  project "AstraDwell", level `/Game/T01_House`
- **How:** the founder ran `import_plan3d.py` (`py "…/import_plan3d.py"` in
  the editor console). The local Claude Code session then read the scene
  back through Epic's Unreal MCP plugin (read-only), linked to this session
  via Remote Control.
- **Evidence:** [docs/evidence/QR-005/](evidence/QR-005/) (raw read-back)

| Check | Result |
|---|---|
| Import | 24 static meshes + 4 materials into `/Game/Plan3D/T01`; 29 actors spawned in Outliner folder Plan3D/T01 |
| Size (Static Mesh Editor, founder) | WALLS Approx Size 1200 × 1000 × 330, 472 triangles: as built |
| All 24 mesh bounds vs build | Match within 0.05 cm |
| North | Bedroom 1 floor at X 23–454, Y −977 to −506 cm: plan north → Unreal −Y, **confirmed** (L-007) |
| PlayerStart | (590, −258.6, 100), inside the Living floor bounds |
| Materials / collision (walls, floor, glass) | M_Wall / M_Floor / M_Glass; CTF_UseComplexAsSimple |

### Found
- The first `py` call failed only because Windows "Extract All" adds an extra
  folder level. Documented the real path in the guide.
- "Video memory exhausted" warning on the founder's GPU with the open-world
  template plus mesh editor open. Not a pipeline issue; advised Medium scalability.

### Not yet verified
- Walking test in Play mode (doors passable, walls/glass blocking).
- NorthMarker text rendering; materials/collision on the remaining 21 meshes.

---

## QR-006: frames, open door leaves and door-swing check (T-013)

- **Date:** 2026-10-20 · **Scope:** training repo only
- **Evidence:** [docs/evidence/QR-006/](evidence/QR-006/)

| Check | Result |
|---|---|
| T01 with `details` (frame 60 mm, leaf 35 mm, both INFERRED D-095/D-096) | 45 parts (14 frames, 7 open leaves); PASS 13, FAIL 0 |
| Hand check of frame, glass and leaf positions (O01, O02, O15) | Exact to 0.00 mm |
| Q18 on T01 | All 7 doors open 90° without hitting a wall or another door |
| Mutation tests | Leaf into a wall and two overlapping swings are flagged; frame width differing from register fails Q08 |
| Plans without `details` (T02–T04, and T01 with details removed) | Build exactly as before (17 / 30 / 21 / 24 parts) |
| GLB in three.js r186 (Chromium) | 45/45 parts, materials and UVs match, 0 errors |
| FBX (Q17) | Pass, 45 meshes, cm |
| Tests | 62 pass |

### Defect found and fixed
- The first frame build unioned boxes with coincident faces: Q12 found 6
  sliver triangles on 5 frames. Frames are now one extruded profile (L-026).

### Not verified
- The new parts in Unreal. Bundle v2 has not been imported yet, and the
  import script's new re-run cleanup and level save are untested in Unreal.

### QR-005 follow-up (2026-10-20, read-only via the PC session)
- **Verified:** materials and collision on all 24 v1 meshes. FLOOR_R01–R08 use M_Floor,
  CEILING_R01–R08 use M_Ceiling, GLASS_O02–O08 use M_Glass and WALLS uses M_Wall, all with
  CTF_UseComplexAsSimple and no overrides.
- **Found:** the v1 script was run a second time instead of v2. Plan3D/T01 then held 58
  actors (two copies of everything) and no v2 assets. The v1 script has no cleanup step
  (L-027), so running v2 removes every actor in that folder before re-importing.
  T01 v2 in Unreal is still pending the founder's re-run.

---

## QR-007: T01 v2 in real Unreal, and walk tests (Q19)

- **Date:** 2026-10-20 · **Scope:** training repo and the training-only AstraDwell Unreal project
- **Evidence:** [docs/evidence/QR-007/](evidence/QR-007/)
- **How:** the founder's PC Claude session ran `import_plan3d.py` (bundle v2)
  through Unreal's Python Remote Execution, then read the level back
  through Unreal MCP (read-only). The founder did not touch the PC.

| Check | Result |
|---|---|
| Re-run cleanup | 58 old actors (v1 imported twice) removed; 0 duplicate labels after |
| Meshes placed | 45/45 `SM_T01_` actors, all in Outliner folder Plan3D/T01 |
| Level save | Saved; not dirty after the run |
| Bounds vs plan3d (DOOR_O01, FRAME_O02, GLASS_O02, DOOR_O15) | Equal to 0.0 cm |
| Materials and collision (FRAME_O01, DOOR_O01, WALLS) | M_Frame / M_Door / M_Wall, no overrides, CTF_UseComplexAsSimple |
| Content folder | 51 assets incl. 6 materials, 7 door and 14 frame meshes |
| Q19 walk tests against the built meshes | t01 26/26, t02 20/20, t03 32/32, t04 24/24 as expected |
| Q19 mutation test | A blocked doorway and a missing wall are both caught |
| Tests | 65 pass |

### Defect found and fixed
- Q19's first version used trimesh ray casting, which needs the
  `rtree` package (not installed): every build crashed. Replaced with a
  numpy segment-triangle test (no new dependency).

### Walk test in Unreal (2026-10-20, 07:00)
- `walk_test.py` traced the same 26 lines against Unreal's collision in
  `/Game/T01_House` (UE 5.8.3), run by the PC session via Remote Execution.
- **Result: 26/26 probes as expected; 26/26 hit the same mesh as plan3d;
  0 meshes missing.** All 8 door/arch lines pass; all 7 windows are stopped
  by their glass and all 11 walls by `SM_T01_L00_WALLS`.
- **Defect found and fixed:** first run failed with `AttributeError:
  GameplayStatics has no attribute break_hit_result` (not in UE 5.8
  Python). The PC session replaced it with `hit.to_tuple()`; the same fix
  is now in `unreal/walk_test.py` (L-028). Remaining warning: the name
  `TRACE_TYPE_QUERY1` is deprecated in 5.8 (still works).
- The PC has no GitHub sign-in, so the script and a slim manifest (project,
  meshes, walk_tests only) were sent inside the message.

### Not yet verified
- Walking with a real character in Play mode (capsule, not lines).
- Twinmotion import.

---

## QR-008: clear walking width (Q20) and two-storey houses with stairs (T-014)

- **Date:** 2026-10-20 · **Scope:** training repo only
- **Evidence:** [docs/evidence/QR-008/](evidence/QR-008/) (T05 QA report, plans, browser check; T01 Q20); tests in `tests/test_walktests.py`, `tests/test_stairs.py`

### Clear walking width (Q20)
| Check | Result |
|---|---|
| T01 clear widths (lines along the wall, 21 depths × 3 heights) | 0.9 m doors 0.745 m; 0.75 m toilet doors 0.595 m; main door 0.845 m; arch 1.600 m. Equal to hand arithmetic (width − 2 × 60 mm frame − 35 mm leaf) |
| Finding | Unreal's DefaultPawn (0.70 m sphere) cannot pass T01's toilet doors O13/O14. Use a walkthrough pawn ≤ 0.55 m wide |
| Mutation | 0.65 m doors (0.495 m clear) → WARN |
| In Unreal | **Not run.** The PC session's safety check refused to write the new `walk_test.py` sent from this session ("Code from External"). It ran the old script in the new folder instead (26/26 again, no sphere sweeps). Needs the founder's approval; not worked around |

### Stacked levels and stairs (T-014)
| Check | Result |
|---|---|
| T05 (fictional G+1, 8 × 10 m, 230/115 mm brick, 1 straight stair) | PASS 13, INFO 9, WARN 0, FAIL 0 (with `--fbx`) |
| Stair S01 | 18 risers × 175.0 mm, going 250 mm, 2R+G 600 mm, run 4.250 m; Living (R01) → Stair hall (R11); landing 1.093 m; headroom clear on all 17 treads |
| Shared slab | Built once: 20 mm ceiling layer below, floor above; Q13 finds no same-facing coplanar overlap (117 back-to-back contacts, hidden) |
| Floor area with the stair opening (Q14) | Stair hall floor = 6.355 − 4.250 m² exactly |
| Stair solid | Watertight; volume equals the sum of 17 tread columns |
| Walk tests (Q19) incl. a line up the stair at chest height | 28/28 as expected |
| GLB in three.js r186 | 45/45 meshes, materials and UVs match (the bounds check now spans all levels) |
| FBX (Q17) | Pass, cm, `M_Stair` |
| Single-level plans T01–T04 | GLB byte-identical to before the change |
| Mutation tests | Level not on the one below → FAIL; flight into a wall → FAIL; landing into a wall → reported; 210 mm risers → WARN; stair removed → upper rooms unreachable (Q09 FAIL); a beam over the flight → Q22 FAIL |
| Tests | 78 pass |

### Defects found and fixed during development
- The browser check took the building height from the ground-floor walls
  only. It now spans all levels.
- The stair-hall label sat on the stair opening and then in an 11 cm strip.
  It now uses the point farthest from all edges (polylabel).
- Clearance probing made the test run 5× slower (144 s). One combined
  triangle array per build brought it back to ~35 s.

### Not verified
- T05 and the sphere sweeps in Unreal (blocked, see above).
- Handrails and fall protection are not modelled or checked.
- Stair rules are training thresholds, not NBC/UDCPR checks.
