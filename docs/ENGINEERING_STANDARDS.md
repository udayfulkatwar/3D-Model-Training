# Engineering Standards

Applies to all geometry, code and documentation in this repository.

## Evidence tags

Every factual claim in project records carries one tag:

| Tag | Meaning |
|---|---|
| `[verified YYYY-MM-DD]` | Checked directly in this repo or by a reproducible command; the date is when it was checked |
| `[reported]` | From the founder or an earlier session; not re-checked here |
| `[assumed]` | Working assumption; must be confirmed before it drives a decision |

## Work status labels

`PLANNED` → `IMPLEMENTED` → `VERIFIED`, or `BLOCKED` / `REJECTED`.
`VERIFIED` requires recorded evidence in [QUALITY_REPORTS.md](QUALITY_REPORTS.md).
Nothing is "production-ready" without an entry in
[RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md).

## Units and coordinate systems

| Context | Length unit | Up axis | Notes |
|---|---|---|---|
| Source data / plan JSON | metre | Z | Origin at a drawing-defined datum, recorded per project |
| Blender | metre | Z | Scene unit scale 1.0 |
| glTF / GLB (web) | metre | Y | glTF 2.0 spec; right-handed, +Y up, +Z forward |
| Unreal Engine | centimetre | Z | Left-handed; verify north orientation on first import |
| Areas in client material | sq ft and m² | — | Always state built-up vs. carpet; compute from geometry, never type in |

Geographic projects record their CRS (e.g. UTM 44N for Nagpur) and the
local-to-geographic transform.

## Geometry rules

1. **Traceability:** every dimension comes from a named drawing and is logged in
   [DRAWING_ASSUMPTIONS.md](DRAWING_ASSUMPTIONS.md) as confirmed or inferred.
2. **Tolerance:** default geometric tolerance 1 mm; snap source dimensions only
   with a recorded reason.
3. **UVs:** every exported face has a UV map.
4. **No coplanar overlaps:** two visible faces never share a plane (they render
   black in Cycles and z-fight in real time); offset ≥ 0.1 m or split.
5. **No degenerate faces:** delete faces with area < 1e-5 m²; no loose vertices.
6. **Sunken elements** (pools, ramps) cut holes in the ground mesh.
7. **Areas** are computed from geometry by script, never entered by hand.

## Naming

- Flat ID: `<Tower>-<Level 2 digits>-<Unit 2 digits>` → `B-07-02`.
- Flat pick volume mesh: `FLAT_<Tower>_L<Level>_F<Unit>` → `FLAT_B_L07_F02`,
  placed inside the flat's walls, slab to slab.
- Materials are named consistently so they can be substituted in Twinmotion
  or by Unreal scripts.

## Asset licensing

Allowed for client work: CC0 (Poly Haven, ambientCG), OpenStreetMap (credit
"© OpenStreetMap contributors"), Copernicus DEM (credit line), assets we
create, and Fab assets under their stated licence. Never use non-commercial
(NC) licences, unlicensed images, or other firms' designs. Record every
third-party asset and its licence alongside the project.

## Code

- Deterministic scripts for geometry, conversion and QA; language-model output
  is never accepted as a measurement without a scripted check.
- Every pipeline step is re-runnable from source data in one command.
- Automated checks run before any export is called done.
- Version control for all source; large binaries via Git LFS or kept out of git.

## Professional boundary

Automated QA checks are sanity checks, **not** UDCPR / NBC / BIS compliance.
Structural, geotechnical, fire and statutory matters require a licensed
architect or engineer. Visualizations never show invented structural systems,
foundations or dimensions as fact.
