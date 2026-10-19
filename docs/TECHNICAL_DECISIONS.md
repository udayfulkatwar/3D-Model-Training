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
