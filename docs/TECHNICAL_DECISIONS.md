# Technical Decisions

ADR-style log. New decisions are appended; superseded ones are marked, never
deleted. "Revisit if" states what evidence would change the decision.

---

### ADR-001 — Purpose of this repository
- **Date:** 2026-10-19 · **Status:** Accepted
- **Decision:** `3D-Model-Training` is an independent training workspace:
  engineering records plus rehearsal/tooling code for the 2D-to-3D pipeline.
  Client deliverables and client drawings are not committed here.
- **Why:** the repo was empty; the founder's standing rule is rehearse before
  client work. See ADR-007 for the access boundary.

### ADR-007: ASTRA DWELL production is view-only
- **Date:** 2026-10-19 · **Status:** Accepted (founder instruction)
- **Decision:** Claude may only view ASTRA DWELL systems: the website and
  its source, `udayfulkatwar/Astra-Management`, ASTRA DWELL docs and artifacts,
  and client material. No edits, commits, pushes, deployments, comments,
  deletions or configuration changes there. All of Claude's work happens in
  this training repo. Anything useful that comes out of training is handed
  to the founder to adopt, or not, at their discretion.
- **Why:** training must not interfere with the company's live work.
- **Revisit if:** the founder explicitly grants write access to a named
  system for a named task.

### ADR-002 — Browser 3D stack: React Three Fiber + three.js
- **Date:** pre-2026-10-19 (existing) · **Status:** Accepted, `[verified 2026-10-19]`
- **Decision:** keep R3F 9.x / three.js (r186 in production) for web experiences.
- **Why:** already shipping; runs on phones without installs; GLB + Draco +
  KTX2 cover compression needs.
- **Rejected:** streaming Unreal (Pixel Streaming) as the default web path,
  because of per-user GPU cost and latency. It stays an option for premium
  sales-gallery use.
- **Revisit if:** target scenes exceed what mid-range phones can render at an
  acceptable measured frame rate.

### ADR-003 — Unreal Engine 5.8 for the sales-gallery flat picker and films
- **Date:** 2026-10-19 · **Status:** Accepted `[reported]`
- **Decision:** UE 5.8.x with Lumen, Movie Render Graph, a DataTable-driven
  flat picker (pick volume per flat + CSV/JSON + UMG). Avoid experimental
  features (Nanite Foliage, Water, Mesh Terrain) in client work.
- **Constraint:** requires Windows + NVIDIA RTX operated by the founder; AI can
  write but not run editor scripts.

### ADR-004 — Twinmotion fed directly from Blender
- **Date:** 2026-10-19 · **Status:** Accepted `[reported]`
- **Decision:** use Twinmotion 2026.1 (stable, not Preview) for fast stills,
  360s and phasing, importing FBX/GLB from Blender. No USD import or Blender
  Direct Link exists, so material names must be consistent for substitution.

### ADR-005 — Cloud GPU first, local hardware later
- **Date:** 2026-10-19 · **Status:** Accepted `[reported]`
- **Decision:** rent an AWS Mumbai GPU instance on demand. Buy a local RTX
  workstation only when cloud spend stays above ~₹15k/month. Request GPU vCPU
  quota days in advance (new accounts start at 0). Always stop instances; set
  a budget alert.
- **Note:** no spending is authorized yet. This records the plan only.

### ADR-006 — Single source of truth for building geometry
- **Date:** 2026-10-19 · **Status:** Accepted (founder authorized T-001); implemented as plan3d v0.1
- **Decision:** introduce a versioned `plan.json` schema (walls, openings,
  rooms, levels, provenance per value) from which every output (web GLB,
  FBX, flats inventory) is generated, with scripted QA against the source.
- **Why:** today each showcase is hand-built in code, so dimensions are not
  traceable and nothing is reusable. This is roadmap item "code-based
  building generator".

### ADR-011: Training stays private, free and separate from business data
- **Date:** 2026-10-20 · **Status:** Accepted (founder instruction)
- **Decision:** (1) no money is spent on this work, and spending is not
  proposed; (2) everything stays private (the GitHub repository is
  private) and nothing is published; (3) training output never enters
  ASTRA DWELL business data: no business folders, documents, repositories,
  skills or connectors, and no messages to other Claude sessions. The PC
  Claude session that runs Unreal works only in `C:\Work\` and the Unreal
  training content. The Unreal project named "AstraDwell" on the founder's PC was
  created only for this training (founder confirmed 2026-10-20); it is training
  data, not business data.
- **Why:** the founder keeps training fully separate from the company.

### ADR-010 — FBX via an isolated Blender worker, stored in centimetres
- **Date:** 2026-10-19 · **Status:** Accepted
- **Decision:** plan3d writes exact meshes to files, and a separate
  process (`plan3d/fbx_worker.py`, the only code importing bpy) builds
  and exports the FBX in centimetres (UnitScaleFactor 1) with named
  `SM_`/`M_` assets and shared plan-origin pivots. A second Blender process
  re-imports it for Q17.
- **Why:** Blender's FBX exporter is the most widely used route into
  Unreal/Twinmotion. Centimetres avoid depending on Unreal's unit-conversion
  option (L-023). The process boundary keeps plan3d itself free of
  GPL-3.0 code (L-025).
- **Legal note (needs a human):** internal use is fine. Before
  distributing plan3d or the worker outside the company, get legal review
  of GPL obligations (AD-50 → lawyer).
- **Rejected:** Autodesk FBX SDK (proprietary licence and install); USD
  as the only output (Twinmotion cannot import USD).
- **Revisit if:** the founder's first Unreal import shows a size, axis or
  material problem.

### ADR-009 — Plan reader: classical image processing, human review, no AGPL
- **Date:** 2026-10-19 · **Status:** Accepted
- **Decision:** read plans with deterministic OpenCV steps (stroke-width
  split, projection-profile deskew, run-length wall extraction,
  sub-pixel grey-level measurement, symbol tests for openings) rather
  than a learned model. Output is always a draft marked INFERRED and
  goes through a review sheet. PDF rasterization uses pypdfium2.
- **Why:** each step can be inspected and tested, and failure causes can
  be found and fixed (QR-003). No training data is available yet.
  PyMuPDF is AGPL (L-021).
- **Rejected for now:** ML segmentation models, which need labelled real
  drawings and would hide failure causes; vector-PDF parsing, which is
  worth adding once real CAD-exported PDFs are available.
- **Revisit if:** real-drawing results (T-010) show styles the classical
  steps cannot handle.

### ADR-008 — plan3d core: Python + shapely + manifold3d, Blender optional
- **Date:** 2026-10-19 · **Status:** Accepted
- **Decision:** 2D layout with shapely (GEOS); 3D solids with manifold3d
  (exact, guaranteed-manifold booleans); GLB via trimesh. Rooms are derived
  from walls (seed point), not drawn. Blender is not a dependency of the
  core; FBX export for Unreal/Twinmotion will be an optional bpy step.
- **Why:** everything installs with pip in seconds, runs headless,
  is deterministic (byte-identical GLB), and is testable in CI. Blender adds
  a 300 MB+ dependency for a format the web path doesn't need.
- **Rejected:** hand-built meshes per wall. They produce coplanar overlaps
  at joints (L-002), and corner handling gets ad hoc.
- **Revisit if:** curved walls, complex roofs or FBX become the main need.
