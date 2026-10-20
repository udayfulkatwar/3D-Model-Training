# plan3d: traceable plan-to-3D generator (v0.1, training)

`plan3d` turns one `plan.json` (walls, openings, rooms and a register of the
drawing's dimensions) into a web-ready GLB, a plan drawing, a room schedule
and QA reports. Every number in the model must trace to a register entry,
and the generated geometry is checked against the register automatically.

Training tool only (ADR-007). Visualization geometry only. Not for
construction, and not a building-code compliance check.

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m plan3d build projects/t01/plan.json -o out/t01   # exit 1 on any FAIL
.venv/bin/python -m pytest -q                                        # 38 tests, ~10 s

# Optional: load the GLB with three.js r186 in headless Chromium
cd viewer && npm install && node check.mjs out/t01                    # writes out/t01/browser_*.png
```

## Reading a drawing into a draft (T-006)

```bash
.venv/bin/python -m plan3d read drawing.png -o drafts/house --known-width 12.0 --build
```

- `--known-width` is the overall east–west external length read off the
  drawing. It sets the scale and is the only value marked CONFIRMED. Use
  `--px-per-m` instead if the scale is known.
- Output: `plan.json` (draft), `review.md` (what to confirm), `overlay.png`
  (detected walls, openings and rooms over the drawing) and, with
  `--build`, the full plan3d build in `build/`.
- Works on filled-wall drawings (PNG/JPG; PDF page 1 via pypdfium2) with
  up to ±5° skew. Room names, heights and sills are not read; they appear
  as defaults or open questions in the review sheet.
- Accuracy on synthetic test drawings: [T006_PLAN_READING.md](T006_PLAN_READING.md#results).
  Not yet tested on real drawings.

## FBX for Unreal Engine / Twinmotion (T-009)

```bash
.venv/bin/pip install -r requirements-fbx.txt          # adds Blender's Python module (~400 MB)
.venv/bin/python -m plan3d build projects/t01/plan.json -o out/t01 --fbx
```

Writes `out/t01/unreal/`:

| File | What it is |
|---|---|
| `T01.fbx` | One static mesh per part (`SM_T01_L00_WALLS`, `…_FLOOR_R01`, …), materials `M_Wall`, `M_Floor`, `M_Ceiling`, `M_Glass`, UVs on every face, flat shading. Stored in **centimetres** (UnitScaleFactor 1), so 1 m = 100 Unreal units without any import conversion. All pivots at the plan origin |
| `unreal_manifest.json` | Asset names, units, axis mapping, PlayerStart and room positions in Unreal cm |
| `rooms.csv` | DataTable-ready room schedule (make struct `S_RoomData`: RoomID, Name, Use, Level, AreaM2, AreaSqft) |
| `import_plan3d.py` | Unreal Editor Python script: imports the FBX, sets walk-through collision, spawns every mesh at 0,0,0, a PlayerStart in the living room, a north marker and basic sun/sky. **Not yet run in Unreal** |

**First import in Unreal (founder, Windows + RTX):**
1. Enable the *Python Editor Script Plugin*, open an empty level.
2. Output Log → Python: `py "C:/…/unreal/import_plan3d.py"`.
3. Check and report back:
   - T01 measures 1200 × 1000 uu;
   - the `NorthMarker` text is on the building's north side (expected at Unreal −Y);
   - Play: you can walk through doors but not walls or windows.

Q17 checks every export: Blender re-imports the FBX, and names, triangle
counts, sizes (±0.1 mm), UVs, materials and centimetre storage must match.

## How a plan is described

| Section | Contents |
|---|---|
| `sources` | The drawings used (title, revision, date, scale) |
| `dimensions` | The register. Each value is `CONFIRMED` (stated on a drawing), `INFERRED` (assumed; a `note` saying why is mandatory) or `OPEN` (unknown; no geometry may use it). Each has a `check` that the QA evaluates |
| `levels`, `wall_types` | Floor level, ceiling height, slab and wall thicknesses |
| `walls` | Centre-line start/end points. Joints are mitred automatically at any angle |
| `openings` | Doors, windows and arches by position along a wall, width, height and sill; doors may state `opens_into` |
| `rooms` | Name, use and a seed point. The room *is* the wall-enclosed region around the seed, so shape and area always come from the walls |
| `stairs` (optional) | `level`, `to_level`, `start` (centre of the first riser), `direction` (N/E/S/W), `width`, `risers`, `going`; `type` `straight` (default) or `dogleg` with `turn` (left/right), `landing` (half-landing depth, default = width) and `gap` (well, default 0) |

Every wall, opening, room, level and wall type carries `prov`: the register
entries that justify it.

**Optional `details`** (one entry: `frame_width`, `door_leaf_thickness`,
`prov`): when present, every door and window gets a frame lining its
reveal, and every door gets a leaf standing open at 90° into the room it
opens into, so walkthroughs pass freely. Window glass sits inside the
frame. Opening widths are treated as **structural** openings, so the clear
width is 2 × frame_width less. Doors may set `"hinge": "start" | "end"`
(default `start`, the end nearer the wall's start point). Arches get no
frame or leaf. Without `details`, plans build exactly as before.

**Stacked levels (T-014).** A level sits on another when its `elevation`
equals the lower floor level + `wall_height` + `roof_thickness`, and its
`floor_thickness` equals that slab (Q21 fails otherwise). The shared slab is
built once: its lowest 20 mm is the lower level's ceiling (lower walls run
up into it), the rest is the upper level's floor (upper walls stand on it).
Where the upper level does not cover the lower one, the lower level gets a
full-thickness roof. Each stair's riser is the floor-to-floor height divided
by `risers`; its footprint is cut out of the upper floor and the lower
ceiling, and the top riser is the slab edge. Rooms on upper levels are
reached through the stair (Q09). A dog-leg climbs half its risers (rounded
up), crosses the half landing and climbs back beside the first flight; its
whole footprint is opened in the floor above. A 0.90 m guard rail
(`GUARD`, `M_Guard`) closes every open edge of a stair opening except the
top riser; walk tests check each guarded edge. See `projects/t05` (G+1,
straight) and `projects/t06` (G+1, dog-leg).

**Dimension check kinds:** `param` (a typed value must equal the register),
`overall` (outer extents), `room_clear` (room clear width/depth, bounding
box), `room_area`, `none`.

## QA checks

| ID | Check | Catches |
|---|---|---|
| Q01 | Schema valid | Missing provenance, INFERRED without a reason, bad types |
| Q02 | Ids and references | Duplicates, dangling references |
| Q03 | Provenance | Geometry built on an `OPEN` item; lists all `INFERRED` inputs |
| Q04 | Wall sanity | Zero/short walls, overlapping walls, thick walls poking through at shallow tees |
| Q05 | Envelope closed | Gaps in the outer walls, empty levels; warns on multi-level plans (unverified) |
| Q06 | Rooms | Seed in a wall, two rooms in one space (missing partition), unassigned spaces |
| Q07 | Openings | Beyond the wall, cutting a crossing wall, overlapping, above ceiling, wrong door swing |
| Q08 | Plan conformance | Geometry disagreeing with the dimension register beyond tolerance |
| Q09 | Circulation | Rooms unreachable through doors, no entrance |
| Q10 | Daylight sanity | Habitable rooms without an external window, internal toilets (not a code check) |
| Q11 | Solids | Non-watertight, empty or inverted meshes |
| Q12 | Degenerate faces | Sliver triangles (< 1e-5 m²) |
| Q13 | Coplanar overlaps | Same-facing overlapping faces between parts (z-fighting) |
| Q14 | Floor areas | 3D floor area differing from the 2D room area |
| Q15 | UVs | Any exported mesh without UVs |
| Q16 | GLB round trip | Names, triangle counts, bounds or UVs lost on export |
| Q17 | FBX round trip (`--fbx`) | FBX not in cm, or names, triangles, sizes, UVs or materials changed |
| Q18 | Door swing clearance | A door leaf that would hit a wall when opened 90°, or two door swings that overlap |
| Q19 | Walk tests | A probe line through a door or arch that is blocked, or one at a wall or window that passes (also run in Unreal by `walk_test.py`) |
| Q20 | Clear walking width | WARN when the gap left by frames and the open leaf is under 0.50 m; lists doors Unreal's 0.70 m DefaultPawn cannot pass (checked in Unreal with sphere sweeps) |
| Q21 | Levels stack; stairs fit | A level that does not sit on the one below; a stair that crosses a wall, starts or lands outside a room, cuts an upper wall, has a landing shallower than its width, or is steep (riser > 190 mm, going < 250 mm, 2R+G outside 550–700 mm: WARN) |
| Q22 | Stair headroom | Anything within 2.0 m above any tread |

If Q04–Q07 fail, no model is exported.

## Outputs (`-o <dir>`)

| File | What it is |
|---|---|
| `model.glb` | glTF 2.0, metres, Y-up. Plan +X (east) → +X, plan +Y (north) → −Z. Named nodes: `L00_WALLS`, `L00_FLOOR_<room>`, `L00_CEILING_<room>`, `L00_GLASS_<opening>`, and with details `L00_FRAME_<opening>`, `L00_DOOR_<opening>`; materials `wall`, `floor`, `ceiling`, `glass`, `frame`, `door` |
| `plan_<level>.png` | Generated plan with clear sizes and areas, for overlaying on the source drawing |
| `rooms.csv` | Room schedule (m, m², sq ft) and which inferred inputs each room depends on |
| `uncertainty.md` | Every INFERRED value and OPEN question, and what uses it |
| `qa_report.md/json` | All checks with details |
| `manifest.json` | Plan hash, axes, per-mesh triangles/volume/bounds, rooms |

Builds are deterministic: the same plan gives a byte-identical GLB.

## Known limits (v0.1)

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md#plan3d-v01). In short:
straight walls; straight and dog-leg stairs only; guard rails around stair openings but no
flight balustrades; no roof
parapet or furniture; one material per element type; plan input is typed
by hand (no PDF/CAD reading yet).
