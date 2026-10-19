# ASTRA DWELL — 3D Model Training

Engineering workspace for ASTRA DWELL ("Experience Spaces Before They're Built."):
rehearsal, training and tooling for turning 2D architectural drawings into
interactive 3D experiences.

**Status (2026-10-19): `plan3d` v0.1 implemented and tested on the fictional
training plan T01.** See [docs/PLAN3D.md](docs/PLAN3D.md).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m plan3d build projects/t01/plan.json -o out/t01
.venv/bin/python -m pytest -q
```

| Path | Contents |
|---|---|
| `plan3d/` | Generator: schema, 2D layout, 3D solids, QA, reports |
| `projects/t01/plan.json` | Training House T01 (fictional 12 × 10 m 3BHK) |
| `tests/` | 38 tests, mostly proving each QA check fails on its defect |
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

## Project records

Read these before starting any work. Each claim is tagged with its source
(`[verified]`, `[reported]`, `[assumed]`), as defined in
[ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md#evidence-tags).

| File | Purpose |
|---|---|
| [PLAN3D.md](docs/PLAN3D.md) | How to use the plan-to-3D generator |
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
