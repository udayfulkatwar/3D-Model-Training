# ASTRA DWELL — 3D Model Training

Engineering workspace for ASTRA DWELL ("Experience Spaces Before They're Built."):
rehearsal, training and tooling for turning 2D architectural drawings into
interactive 3D experiences.

**Status (2026-10-20):** `plan3d` v0.1 builds checked 3D models from a
plan file (T-001). The plan reader turns a floor-plan image into a draft
plan file for human review (T-006). `--fbx` adds an FBX + Unreal import
bundle (T-009), verified in Unreal 5.8 with walk tests (QR-005, QR-007).
Two-storey houses with straight or dog-leg stairs build and pass QA
(T-014, T05, T06).
AutoCAD DXF plans read into drafts with exact geometry and room names
(T-016, our own test files). All tested on fictional training plans only. See [docs/PLAN3D.md](docs/PLAN3D.md).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m plan3d build projects/t01/plan.json -o out/t01          # plan -> model
.venv/bin/python -m plan3d read drawing.png -o drafts/x --known-width 12 --build   # drawing -> draft -> model
.venv/bin/python -m plan3d read-dxf plan.dxf -o drafts/y --build              # AutoCAD DXF -> draft -> model
.venv/bin/python -m pytest -q                                               # 96 tests
.venv/bin/python -m bench.run                                               # reader benchmark
.venv/bin/pip install -r requirements-fbx.txt                               # optional: Blender for FBX
.venv/bin/python -m plan3d build projects/t01/plan.json -o out/t01 --fbx    # + Unreal bundle in out/t01/unreal
```

| Path | Contents |
|---|---|
| `plan3d/` | Generator: schema, 2D layout, 3D solids, QA, reports |
| `projects/t01…t06/` | Fictional training plans (T03, T04 = reader holdouts; T05, T06 = two storeys) |
| `bench/` | Renders plans as test drawings and DXF files and scores the readers |
| `tests/` | 96 tests: QA checks fail on their defects; reader hard cases; FBX; stairs |
| `unreal/` | Unreal Editor import and walk-test scripts (verified in UE 5.8) |
| `viewer/` | three.js r186 viewer + headless-browser load check |
| `docs/evidence/` | Saved QA evidence referenced by QUALITY_REPORTS.md |

Founder rules in force:

- **Independent training workspace.** Everything here is training, separate
  from ASTRA DWELL's production work.
- **ASTRA DWELL is view-only.** No edits, commits, deployments, comments or
  any other change to ASTRA DWELL systems: the website
  (dwell.astragrp.net) and its source, the `Astra-Management` repo, ASTRA
  DWELL documents and artifacts, and client material. Reading them for
  reference is allowed (founder instruction, 2026-10-19).
- Train and rehearse first; no client model, no paid service and no public
  deployment until the founder authorizes it.
- **No money, ever:** no paid services, purchases or subscriptions for this
  training work. Spending is not even proposed (founder, 2026-10-20).
- **Private:** the repository stays private (verified 2026-10-20); nothing
  is published, shared publicly or uploaded anywhere public.
- **Separate from ASTRA DWELL business data:** training work is never
  written to ASTRA DWELL business folders, documents, repositories, skills,
  connectors or other Claude sessions (ADR-011).

## Project records

Read these before starting any work. Each claim is tagged with its source
(`[verified]`, `[reported]`, `[assumed]`), as defined in
[ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md#evidence-tags).

| File | Purpose |
|---|---|
| [PLAN3D.md](docs/PLAN3D.md) | How to use the plan-to-3D generator and plan reader |
| [T006_PLAN_READING.md](docs/T006_PLAN_READING.md) | Reader method, pre-registered targets and all results |
| [COMPANY_CONTEXT.md](docs/COMPANY_CONTEXT.md) | Company, products, customers, constraints |
| [ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md) | Units, axes, naming, geometry rules, status labels |
| [SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) | What exists today and the target pipeline |
| [PROJECT_REQUIREMENTS.md](docs/PROJECT_REQUIREMENTS.md) | Intended products vs. current capability |
| [DRAWING_ASSUMPTIONS.md](docs/DRAWING_ASSUMPTIONS.md) | Per-drawing confirmed vs. inferred register |
| [TECHNICAL_DECISIONS.md](docs/TECHNICAL_DECISIONS.md) | Decision log (ADR style) |
| [RESPONSIBILITY_MATRIX.md](docs/RESPONSIBILITY_MATRIX.md) | 50 specialist roles; AI vs. human boundaries |
| [REFERENCE_LIBRARY.md](docs/REFERENCE_LIBRARY.md) | Curriculum, official sources, knowledge-gap register |
| [LESSONS_LEARNED.md](docs/LESSONS_LEARNED.md) | Lessons from real work, with evidence |
| [TASK_TRACKER.md](docs/TASK_TRACKER.md) | Prioritized roadmap and next task |
| [QUALITY_REPORTS.md](docs/QUALITY_REPORTS.md) | Inspections, test runs, audits |
| [RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md) | Evidence behind anything released |
| [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) | What we cannot do or have not verified |

## Professional boundary

Visualizations here are presentation models. They are not engineering
designs, construction drawings, structural calculations or statutory
compliance checks. Those require qualified, licensed professionals.
