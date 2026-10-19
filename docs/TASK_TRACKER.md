# Task Tracker

## Done

| ID | Task | Status | Date |
|---|---|---|---|
| T-000 | Initialize repo: inspect state, website stack, write project records | IMPLEMENTED (records await founder review; website findings in QR-001) | 2026-10-19 |
| T-006 | Plan reader v0.1: image → draft plan.json + review sheet + overlay | IMPLEMENTED; pre-registered targets met on holdout 2 (T04, 2/2) and all tuned-on runs; holdout 1 was 2/3 before fixes (QR-003). **Not tested on real drawings** | 2026-10-19 |
| T-001 | plan.json schema + generator + QA (`plan3d` v0.1) on fictional T01 | IMPLEMENTED; acceptance criteria 1, 3, 5 VERIFIED in training (QR-002); 2 partial (opening positions not checked against a drawing); 4 open (needs T-003 real devices) | 2026-10-19 |

## Prioritized roadmap (proposed; founder to approve order)

Priority considers customer value, the dependency chain, and what can be
verified without spending money.

| Pri | ID | Task | Lead → Reviewer | AI / Human | Status |
|---|---|---|---|---|---|
| 1 | T-009 | plan3d v0.2: FBX/Unreal-ready export (Blender bpy), door leaves and frames, roof/parapet once D-091 is answered, multi-level stacking | AD-13 → AD-11 | AI | PLANNED |
| 2 | T-002 | Web GLB optimization step (Draco/meshopt + KTX2, size budget) plus a headless load test | AD-18 → AD-34 | AI | PLANNED |
| 3 | T-003 | Define target-device list and measure H01 on real phones (load time, FPS) | AD-34 → AD-33 | Human measures, AI analyses | PLANNED |
| — | T-004 | ~~Add the website source repo to this workflow; CI for build + Playwright smoke test~~ | — | — | REJECTED (violates ADR-007: ASTRA DWELL is view-only) |
| 5 | T-005 | Rehearse the Unreal import with a training copy of the script in this repo; founder runs it on an RTX machine if they choose | AD-12 → AD-11 | Founder | BLOCKED (hardware) |
| 0 | T-010 | **Real-drawing evaluation of the reader**: 5–10 real plans the company owns or has written permission to use; truth measured by hand; same metrics | AD-28 → AD-05 | Founder supplies drawings and permission; AI runs and reports | BLOCKED (needs drawings) |
| 6 | T-011 | Reader v0.2: OCR for room names and dimension strings (cross-check scale), hollow-wall support | AD-28 → AD-05 | AI | PLANNED (after T-010) |
| 7 | T-007 | IFC intake prototype (IfcOpenShell → plan.json/GLB) on a public sample | AD-06 → AD-13 | AI | PLANNED |
| 8 | T-008 | Write failure case studies (Mars Climate Orbiter, Ariane 5) as unit-safety controls | AD-33 → AD-01 | AI | PLANNED |

## Highest-value next task

**T-010 (real-drawing evaluation).** The reader works on synthetic
drawings, but every test drawing comes from one renderer. Until it is
measured on real plans, its accuracy on client work is unknown. This
needs 5–10 drawings that ASTRA DWELL owns or has written permission to
use (L-010). If none are available yet, the best AI-only task is
**T-009** (FBX/Unreal-ready export). Training repo only (ADR-007).
