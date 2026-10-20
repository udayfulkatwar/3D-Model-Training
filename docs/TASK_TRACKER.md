# Task Tracker

## Done

| ID | Task | Status | Date |
|---|---|---|---|
| T-000 | Initialize repo: inspect state, website stack, write project records | IMPLEMENTED (records await founder review; website findings in QR-001) | 2026-10-19 |
| T-013 | Frames, open door leaves, glazing inside frames, door-swing check Q18 (`details`) | IMPLEMENTED; positions exact to 0.00 mm by hand check; GLB/FBX/browser checks pass (QR-006). Parapet (D-091 OPEN) and multi-level not done | 2026-10-20 |
| T-009 | FBX export for Unreal/Twinmotion + Unreal import script (`--fbx`) | IMPLEMENTED; verified by Blender re-import and an independent reader (QR-004). Imported and verified in UE 5.8 (QR-005, QR-007) | 2026-10-19 |
| T-006 | Plan reader v0.1: image → draft plan.json + review sheet + overlay | IMPLEMENTED; pre-registered targets met on holdout 2 (T04, 2/2) and all tuned-on runs; holdout 1 was 2/3 before fixes (QR-003). **Not tested on real drawings** | 2026-10-19 |
| T-001 | plan.json schema + generator + QA (`plan3d` v0.1) on fictional T01 | IMPLEMENTED; acceptance criteria 1, 3, 5 VERIFIED in training (QR-002); 2 partial (opening positions not checked against a drawing); 4 open (needs T-003 real devices) | 2026-10-19 |

## Prioritized roadmap (proposed; founder to approve order)

Priority considers customer value, the dependency chain, and what can be
verified without spending money.

| Pri | ID | Task | Lead → Reviewer | AI / Human | Status |
|---|---|---|---|---|---|
| 0 | T-012 | **First Unreal import of T01**: run `import_plan3d.py` and check size, north, collision and materials (PLAN3D.md checklist) | AD-11 → AD-12 | AI via the founder's PC session (Remote Control + Python Remote Execution) | VERIFIED (QR-005, QR-007): import, size, north, PlayerStart, materials/collision, v2 frames/doors exact to 0.0 cm, walk test 26/26 in Unreal |
| 1 | T-014 | Multi-level stacking (shared slabs, straight stairs, stair openings, Q21/Q22) and roof parapet | AD-13 → AD-05 | AI (parapet needs D-091) | Stacking, straight and dog-leg stairs IMPLEMENTED (QR-008, T05/T06 G+1); not yet in Unreal. Parapet BLOCKED on D-091; handrails/guards PLANNED |
| 1 | T-015 | Unreal: sphere-sweep clear-width test (Q20) and T05 import | AD-11 → AD-12 | AI via PC session | BLOCKED: the PC session's safety check refuses to write scripts sent from this session; needs the founder's one-time approval |
| 2 | T-002 | Web GLB optimization step (Draco/meshopt + KTX2, size budget) plus a headless load test | AD-18 → AD-34 | AI | PLANNED |
| 3 | T-003 | Define target-device list and measure H01 on real phones (load time, FPS) | AD-34 → AD-33 | Human measures, AI analyses | PLANNED |
| — | T-004 | ~~Add the website source repo to this workflow; CI for build + Playwright smoke test~~ | — | — | REJECTED (violates ADR-007: ASTRA DWELL is view-only) |
| — | T-005 | ~~Rehearse the Unreal import with a training copy of the script~~ | — | — | SUPERSEDED by T-009 (script written) and T-012 (founder import) |
| 0 | T-010 | **Real-drawing evaluation of the reader**: 5–10 real plans the company owns or has written permission to use; truth measured by hand; same metrics | AD-28 → AD-05 | Founder supplies drawings and permission; AI runs and reports | BLOCKED (needs drawings) |
| 6 | T-011 | Reader v0.2: OCR for room names and dimension strings (cross-check scale), hollow-wall support | AD-28 → AD-05 | AI | PLANNED (after T-010) |
| 7 | T-007 | IFC intake prototype (IfcOpenShell → plan.json/GLB) on a public sample | AD-06 → AD-13 | AI | PLANNED |
| 8 | T-008 | Write failure case studies (Mars Climate Orbiter, Ariane 5) as unit-safety controls | AD-33 → AD-01 | AI | PLANNED |

## Highest-value next task

**T-010 (real-drawing evaluation).** The reader works on synthetic
drawings, but every test drawing comes from one renderer. Until it is
measured on real plans, its accuracy on client work is unknown. This
needs 5–10 drawings that ASTRA DWELL owns or has written permission to
use (L-010). Equally important: **T-012**, the founder's first Unreal
import of the T01 FBX, which is the only way to confirm the Unreal side.
The best AI-only task while those wait is **T-013** (door/window frames,
roof). Training repo only (ADR-007).
