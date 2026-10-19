# Project Requirements — Capability Gap Analysis

Intended product scope (from the founder's operating brief) compared with
demonstrated capability as of 2026-10-19.

Status of each capability: `DEMONSTRATED` (exists in a showcase build),
`PROTOTYPE` (built once, untested or internal), `PLANNED`, or
`OUT OF SCOPE (NOW)` (deliberately deferred).

| # | Product | Status | Evidence / gap |
|---|---|---|---|
| 1 | Accurate 2D-to-3D conversion | PROTOTYPE | Done per project in code; no reusable plan schema, generator or plan-conformance check. **Largest gap; it drives every other product.** |
| 2 | Interactive real-time walkthroughs (web) | DEMONSTRATED | H01 / Maquette 01 on website (R3F, three.js r186) |
| 3 | Realistic exterior & interior visualization | PROTOTYPE | Cycles CPU stills from Blender; Twinmotion/Unreal pipeline not yet run |
| 4 | Furniture, materials, colour customization | DEMONSTRATED | H01 material/finish switching `[reported]` |
| 5 | Lighting & day/night simulation | DEMONSTRATED (illustrative) | Morning-to-night presets. Not a daylight/solar study; must not be sold as one |
| 6 | Browser-based property experiences | DEMONSTRATED | Website; shareable links |
| 7 | Unreal Engine immersive environments | PLANNED | Import scripts written but untested; needs founder on Windows + RTX |
| 8 | Interactive property marketing apps (flat picker) | PROTOTYPE | three.js picker artifact for Township 01; Unreal version planned |
| 9 | BIM-connected visualization | PLANNED | No IFC/Revit intake yet. Candidate: IfcOpenShell → plan.json/GLB |
| 10 | Data-connected digital twins | OUT OF SCOPE (NOW) | No live data sources. Never market as a twin without a live data link |
| 11 | Construction planning visualization (4D phasing) | PLANNED | Twinmotion phasing is an option; no schedule-data integration |
| 12 | AR/VR | PLANNED | WebXR possible from the R3F stack; not built or device-tested |
| 13 | Analysis & simulation | OUT OF SCOPE (NOW) | Any future solar/energy analysis must use validated tools and state limits |

## Acceptance criteria for core product #1 (draft, for approval)

A plan-to-3D conversion is acceptable when:

1. Every dimension in the model traces to a drawing value or a logged
   inferred assumption.
2. Wall centre-lines and openings match the source within the stated
   tolerance (default ±10 mm for dimensioned values), checked by script.
3. Room areas computed from geometry match drawing schedules within ±1%, or
   the discrepancy is reported.
4. The web GLB loads on the agreed target devices with measured load time
   and frame rate recorded, not estimated.
5. An uncertainty report lists every inferred value and open question.
