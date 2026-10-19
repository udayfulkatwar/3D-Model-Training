# Task Tracker

## Done

| ID | Task | Status | Date |
|---|---|---|---|
| T-000 | Initialize repo: inspect state, website stack, write project records | IMPLEMENTED (records await founder review; website findings in QR-001) | 2026-10-19 |

## Prioritized roadmap (proposed; founder to approve order)

Priority considers customer value, the dependency chain, and what can be
verified without spending money.

| Pri | ID | Task | Lead → Reviewer | AI / Human | Status |
|---|---|---|---|---|---|
| 1 | T-001 | **plan.json schema + generator + QA** (ADR-006): JSON schema for levels/walls/openings/rooms with per-value provenance; bpy/trimesh generator → GLB + FBX; automated checks (areas from geometry, wall/opening conformance, UVs, no coplanar/degenerate faces). Rehearse on HOUSE H01's fictional 12 × 10 m plan. | AD-13 → AD-05 | AI builds and tests; founder reviews | PLANNED |
| 2 | T-002 | Web GLB optimization step (Draco/meshopt + KTX2, size budget) plus a headless load test | AD-18 → AD-34 | AI | PLANNED |
| 3 | T-003 | Define target-device list and measure H01 on real phones (load time, FPS) | AD-34 → AD-33 | Human measures, AI analyses | PLANNED |
| — | T-004 | ~~Add the website source repo to this workflow; CI for build + Playwright smoke test~~ | — | — | REJECTED (violates ADR-007: ASTRA DWELL is view-only) |
| 5 | T-005 | Rehearse the Unreal import with a training copy of the script in this repo; founder runs it on an RTX machine if they choose | AD-12 → AD-11 | Founder | BLOCKED (hardware) |
| 6 | T-006 | Plan-reading assist: OCR of dimension strings from PDF/image plans into plan.json drafts, always human-confirmed | AD-28 → AD-05 | AI prototype | PLANNED (after T-001) |
| 7 | T-007 | IFC intake prototype (IfcOpenShell → plan.json/GLB) on a public sample | AD-06 → AD-13 | AI | PLANNED |
| 8 | T-008 | Write failure case studies (Mars Climate Orbiter, Ariane 5) as unit-safety controls | AD-33 → AD-01 | AI | PLANNED |

## Highest-value next task

**T-001.** Every product (web walkthrough, Unreal picker, films, BIM) depends
on turning a drawing into traceable, checked geometry. Today that is redone
by hand for each project. T-001 is reusable, needs no paid services, is fully
testable in this environment, and is the roadmap's "code-based building
generator". It is built and tested only in this training repo. Nothing is
applied to ASTRA DWELL systems (ADR-007). Awaiting founder authorization.
