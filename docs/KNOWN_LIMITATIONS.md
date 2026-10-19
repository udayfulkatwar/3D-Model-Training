# Known Limitations

## Professional and claims boundaries

- Our models are **visualizations**, not engineering designs. No structural,
  foundation, MEP, fire or statutory-compliance content is verified by us.
- Lighting and day/night are **illustrative**, not solar or daylight studies.
- Automated QA checks are sanity checks, not UDCPR/NBC/BIS compliance.
- Nothing we build is a "digital twin" until it has a verified live data
  connection.
- Plan-to-3D accuracy can be no better than the source drawings. Undimensioned
  values are inferences and are logged as such.

## Access boundary

ASTRA DWELL production (website and source, `Astra-Management`, company docs,
artifacts, client material) is **view-only** (ADR-007). Training output stays
in this repo until the founder adopts it themselves.

## Capability limits (this environment)

| Limit | Consequence |
|---|---|
| Claude cannot run Unreal Engine or Twinmotion (needs Windows + NVIDIA RTX) | Editor scripts are written but untested until the founder runs them |
| Claude cannot click inside 3D software GUIs | Work is scripted (bpy, Python) or reviewed from screenshots |
| Rendering here is CPU-only (Cycles) | Stills take minutes; no real-time GPU quality judgement |
| Headless browser uses software GL | Functional tests only; frame rates here say nothing about phones |
| Session containers are ephemeral | Anything not committed and pushed is lost |
| Network access varies per session | Asset downloads (Poly Haven, OSM) may fail; procedural fallbacks needed |
| GitHub MCP tools failed to connect on 2026-10-19 | PR/issue operations unavailable this session; git push used directly |

## plan3d v0.1

| Limit | Effect / workaround |
|---|---|
| Single level only | Multi-level plans are warned (Q05). Stacked slabs would overlap |
| Straight walls only | No curved walls or columns |
| Plan input typed by hand | No PDF/DWG/image reading yet (T-006). Typing errors are caught only where the register checks them |
| Opening positions not checked against the drawing | Only sizes are checked; positions carry INFERRED D-050 |
| `room_clear` uses the bounding box | Exact for rectangular rooms only; use `room_area` for other shapes |
| No door leaves, frames, sills, skirting, stairs, furniture | Openings are voids; windows are a single glazing pane |
| Roof = per-room ceiling slabs + wall tops | Visible seams from above; no parapet (D-091 OPEN) |
| One material per element type | No per-room finishes yet |
| GLB only, uncompressed | No FBX/Unreal export, Draco/KTX2 or LOD yet (T-002, T-009) |
| glTF stores float32 positions | ~1 µm position precision near the origin; fine for buildings, but keep the origin near the site |
| Daylight check counts window area only | Not a daylight factor and not a code check |
| Browser check uses software GL | Proves loading and correctness, not phone performance (T-003) |

## Plan reader v0.1 (T-006)

| Limit | Effect / workaround |
|---|---|
| Tested only on synthetic drawings from one renderer | Accuracy on real CAD exports, scans and photos is unknown. Every draft must be reviewed |
| Filled (poché) walls only | Hollow double-line or hatched walls are not detected |
| Orthogonal walls, skew ≤ ±5° | Diagonal or curved walls are lost; no perspective correction for photos |
| No text reading (no OCR) | Room names and uses, dimension values, heights and sills are not read |
| Windows read ~20 mm narrow | Jamb lines at the wall ends; correct widths in review |
| Wall thickness ±5 mm on scans | e.g. 115 mm read as 120 mm; snap types in review |
| One floor per image, first PDF page only | Crop multi-plan sheets before reading |
| Door swing is the leaf side only | The hinge side is not exported |

## FBX export v0.1 (T-009)

| Limit | Effect / workaround |
|---|---|
| Never imported into Unreal or Twinmotion | First import must be checked by the founder (PLAN3D.md checklist) |
| Needs Blender's Python module (~400 MB, GPL-3.0) | Optional install; runs as a separate process (ADR-010) |
| Flat colour materials only | No textures; replace with Unreal/Fab materials by name (`M_Wall` etc.) |
| Collision = complex-as-simple on every mesh | Correct for walking through doors; heavier than simple collision for big projects |
| No lightmap UVs exported | The import script lets Unreal generate them; not needed with Lumen |
| FBX not byte-identical between runs | The file holds a creation timestamp; geometry is identical |

## Unverified items

- Website source location, build and deployment process (G-01).
- Real-device performance of any experience (G-03).
- Showcase facts marked `[reported]` in COMPANY_CONTEXT.md.
