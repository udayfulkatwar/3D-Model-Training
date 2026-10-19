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
