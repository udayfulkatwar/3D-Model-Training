# Reference Library & Knowledge-Gap Register

**Honesty note:** listing a book here defines subject coverage. It does not
mean the book has been ingested, memorized or verified. Never quote passages,
page numbers or formulas from memory as if cited. Cite only sources actually
opened, with the edition and the date accessed.

## Primary sources: consult before relying on memory

These change often; check the current version each time.

| Domain | Source | Used for |
|---|---|---|
| Web 3D | three.js docs & release notes; pmndrs/react-three-fiber docs | API behaviour (prod: r186 / R3F 9.8.1) |
| Formats | Khronos glTF 2.0 spec; KTX2 / Basis; Draco; meshoptimizer | Web asset pipeline |
| Blender | docs.blender.org Python API (bpy 5.x) | Geometry generation |
| Unreal | dev.epicgames.com UE 5.8 docs | Lumen, Nanite, Movie Render Graph, Pixel Streaming |
| Twinmotion | Twinmotion 2026.1 docs | Import formats, phasing |
| BIM | buildingSMART IFC 4.x; ISO 19650; IfcOpenShell docs | BIM intake |
| India codes | NBC 2016 (current amendments), relevant BIS codes, UDCPR (Maharashtra) | Awareness only. Compliance is a licensed professional's call |
| Accessibility | WCAG 2.2 | Web UI |
| Security | OWASP ASVS / Top 10 | Web & backend |

## Curriculum coverage

Subjects from the operating brief, grouped. Books listed there (Hibbeler,
Das, Ching, Neufert, CLRS, Kleppmann, *Real-Time Rendering*, *PBR*,
de Berg, *BIM Handbook*, etc.) are the coverage benchmark.

| Area | Most relevant now | Why |
|---|---|---|
| Computational geometry | Polygon offsetting, booleans, triangulation, robustness | Walls/openings from plans; sliver faces were a real defect |
| Real-time rendering | PBR materials, light baking vs. dynamic, LOD, compression | Phone performance |
| Architectural graphics | Plan conventions, dimension strings, symbols | Reading drawings correctly |
| Building construction | Typical Indian wall/slab dimensions, floor-to-floor heights | Labelled inferences only, never facts |
| Computer vision | OCR of dimension text, line detection | Future plan-reading assist (human-verified) |
| Psychology / decision-making | Planning fallacy, automation bias, overconfidence | Estimates and trust in AI-extracted measurements |

## Failure & experience library (planned entries)

Study only from primary or well-documented sources (official investigation
reports, peer-reviewed analyses), each with a confidence level.

| Incident | Transferable lesson for us | Status |
|---|---|---|
| Mars Climate Orbiter (1999) | Unit mismatch between systems: our m ↔ cm ↔ ft/sq ft conversions must be explicit and tested | To write up |
| Ariane 5 Flight 501 (1996) | Reused code under new assumptions: re-validate reused generators per project | To write up |
| Therac-25 | Overtrust in software, no independent interlock: automated QA plus human review | To write up |
| Hyatt Regency walkway (1981) | A design change in communication between parties: track drawing revisions | To write up |

## Knowledge-gap register

| ID | Gap | Impact | How to close |
|---|---|---|---|
| G-01 | Website source not readable here | Training can only study the public site, not its code | Founder may share it read-only; it is never modified (ADR-007) |
| G-02 | No real client drawings to calibrate plan reading | Accuracy claims untested | Use owned/fictional drawings first; then one consented client plan |
| G-03 | No measured phone performance data | Can't promise device support | Define target device list; measure H01 on real phones |
| G-04 | ~~Unreal scripts untested~~ | Closed for T01 (QR-005, QR-007): import, size, north, materials, collision and walk lines verified in UE 5.8 | Remaining: T06 (two storeys) and the clear-width sweeps in Unreal (T-015) |
| G-05 | UDCPR / NBC applicability not reviewed by a professional | Risk of implying compliance | Never claim it; engage architect per real project |
| G-06 | IFC/BIM intake not explored | Product #9 unavailable | Prototype with IfcOpenShell on a public sample IFC |
