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
