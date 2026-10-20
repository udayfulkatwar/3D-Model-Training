# System Architecture

## 1. Public website (dwell.astragrp.net) — `[verified 2026-10-19]`

Determined by fetching the live site and its JavaScript bundles:

| Aspect | Finding |
|---|---|
| Framework | Next.js, static export (Turbopack build; `/_next/static/chunks/*`) |
| Hosting | GitHub Pages (server `GitHub.com`, Fastly CDN; DNS → `udayfulkatwar.github.io`) |
| Domain registrar | Squarespace `[reported]` |
| 3D runtime | three.js **r186** via React Three Fiber **9.8.1** |
| Loaders present | GLTFLoader, DRACOLoader, KTX2Loader, PMREMGenerator; RectAreaLight used |
| 3D code chunk | ~1.06 MB raw / ~287 KB gzip (code only, excluding model data) |
| Pages checked | `/` (home) and `/experience` (Maquette 01, HOUSE H01) |

**View-only (ADR-007).** The website and its source belong to ASTRA DWELL
production. This training repo never modifies them. Findings above come
from reading the public site only.

## 2. Content pipelines today

```
 Drawing dimensions ──► parametric model in code (AI-assisted) ──► GLB ──► R3F viewer on website
                                                         [reported: H01, Canopy]

 project.json + OSM ──► Blender bpy (headless) ──► FBX / GLB / USD + flats.csv
                              │                          │
                              ▼                          ▼
                       qa_check.py              Cycles CPU stills / 360 / orbit
                     (26 sanity checks)                  │
                              │                          ▼
                              └──────────► unreal/import_*.py  (written, UNTESTED)
                                            three.js flat picker (artifact prototype)
                                 [reported: Township 01 v2, in udayfulkatwar/Astra-Management]
```

## 2b. Training pipeline in this repo: plan3d v0.1 — IMPLEMENTED

```
 drawing.png / .jpg / .pdf ─► plan3d.read_raster (T-006; filled walls, hollow walls not verified)
                              ─► draft plan.json + review.md + overlay.png
                                                                │  person confirms / corrects
                                                                ▼
```

```
 projects/<p>/plan.json ─► schema + reference + provenance checks (Q01–Q03)
          │
          ▼
 plan2d: wall strips + mitred joints ─► footprint ─► enclosed regions ─► rooms by seed
          │      openings placed on walls, circulation graph       (Q04–Q10)
          ▼
 mesh3d: manifold3d prisms; walls minus opening voids; per-room floor/ceiling; glazing;
          │ frames, open leaves (details); stacked levels share one split slab;
          │ straight/dog-leg stairs, stair openings, guard rails, balustrades
          │                                     (Q11–Q14, Q18 swing, Q21 stacking/stairs)
          ▼
 walk tests: probe lines (doors pass, walls/glass/rails block), clear widths, headroom
          │                                                         (Q19, Q20, Q22)
          ▼
 export: box UVs, Z-up → glTF Y-up ─► model.glb ─► re-import check   (Q15–Q16)
          │   --fbx: isolated Blender worker ─► <id>.fbx (cm) ─► re-import check (Q17)
          │          + unreal_manifest.json (walk tests in Unreal cm) + import/walk-test scripts
          └─► plan PNGs per level, rooms.csv, uncertainty.md, qa_report, manifest.json
 viewer/check.mjs: three.js r186 in headless Chromium loads the GLB and compares to manifest
 Unreal 5.8 (founder's PC, training project): import_plan3d.py + walk_test.py via Python
   Remote Execution, read back over Unreal MCP. T01 VERIFIED (QR-005, QR-007)
```

Details: [PLAN3D.md](PLAN3D.md). Evidence: QR-002, QR-004–QR-008.

## 3. Target architecture (PLANNED)

```
            ┌────────────────────────────────────────────────┐
 Source     │ PDF/DWG/DXF/image plans ─► plan.json (schema,  │
 intake     │ confirmed vs inferred, provenance per value)   │
            └───────────────────────┬────────────────────────┘
                                    ▼
 Geometry   Generator (Python + bpy, deterministic) ─► named, UV'd meshes
                                    ▼
 QA         Automated checks (geometry, areas, naming, plan conformance) ─► report
                                    ▼
 Outputs    ├─ Web GLB (Draco/meshopt + KTX2, LOD) ─► R3F experience on any phone
            ├─ FBX/Datasmith ─► Twinmotion stills / films
            ├─ FBX/USD ─► Unreal 5.8 (Lumen) flat picker, Movie Render Graph films,
            │             Pixel Streaming (cloud) or packaged .exe (sales office)
            └─ flats.csv/json ─► inventory data for both pickers
```

Design principles: one source of truth (plan.json) feeding every output;
every step scripted and re-runnable; web first because it reaches the most
buyers at the lowest cost per view.

## 4. Infrastructure

| Item | State |
|---|---|
| This repo | Docs only; no CI yet |
| GPU compute | None owned. Plan: AWS Mumbai GPU instance on demand; buy a local RTX PC only once cloud spend stays above ~₹15k/month `[reported]` |
| Unreal / Twinmotion | Free under US$1M revenue; need Windows + NVIDIA RTX, operated by the founder `[reported]` |
