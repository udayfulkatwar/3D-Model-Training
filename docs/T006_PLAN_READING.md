# T-006: Plan reading assist (image → draft plan.json)

Status: **pre-registration**. Targets below were written and committed
*before* the reader was built or run, so results cannot be tuned to them
after the fact.

## Goal

Turn a raster floor-plan image (PNG/JPG, or a PDF page rasterized first)
into a **draft** `plan.json` plus a review sheet. A person confirms or
corrects the draft before plan3d builds a model from it. The reader never
marks anything it measured as CONFIRMED. Only the one dimension the person
supplies for scale is CONFIRMED.

## Scope of v0.1

- Drawings with **filled (poché) walls**, orthogonal walls, small skew allowed.
- Reads walls (centre-lines, thickness), openings (door / window / arch,
  width, position, door swing side) and enclosed rooms.
- Does **not** read text (no OCR available): room names, uses, sill heights,
  ceiling heights and door heights are left as defaults or questions for the
  reviewer.
- Not supported: hollow double-line walls, curved or diagonal walls,
  multi-storey sheets, hand sketches.

## Test method

Ground truth: fictional plans T01 and T02 (different wall thicknesses,
L-shaped rooms, 1.8 m² toilet). Each is rendered as an architect-style
drawing with clutter that must be ignored: furniture, toilet floor hatching,
door leaves and arcs, window symbols, dimension chains, room text, a filled
north arrow and a title. Scale is given as the overall external width (as a
person would read it off the drawing).

| Case | Resolution | Degradation |
|---|---|---|
| clean-100 | 100 px/m (1:100 at 254 dpi) | none |
| clean-60 | 60 px/m | none |
| scan-100 | 100 px/m | 1.5° rotation, blur σ=1 px, noise σ=12, JPEG q=60 |

Each case is run on T01 and T02 (6 runs).

## Metrics

- **Wall boundary offset:** |footprint(truth) Δ footprint(draft)| ÷ boundary
  length of the truth footprint = mean distance between wall faces (mm).
- **Rooms:** a truth room is recovered if a draft room overlaps it with
  IoU ≥ 0.9; area error = |draft − truth| ÷ truth.
- **Openings:** matched if the centres are within 0.3 m on a wall of the same
  orientation. Recall, precision, centre error, width error, kind accuracy
  (door/window/arch), swing accuracy (door opens into the correct room).
- **Draft validity:** the draft plan builds in plan3d with 0 FAIL.

## Targets (fixed before running)

| Metric | clean-100 and clean-60 | scan-100 |
|---|---|---|
| Wall boundary offset | ≤ 15 mm | ≤ 25 mm |
| Rooms recovered | 100% | 100% |
| Room area error (each) | ≤ 2% | ≤ 3% |
| Opening recall / precision | 100% / 100% | ≥ 90% / ≥ 90% |
| Opening kind accuracy | 100% | ≥ 90% |
| Door swing accuracy | ≥ 90% | ≥ 80% |
| Opening width error (mean) | ≤ 30 mm | ≤ 50 mm |
| Draft builds with 0 FAIL | yes | yes |

A run that misses a target is reported as missed. Targets are not changed
afterwards.

## Results

(Filled in after the runs; see QUALITY_REPORTS.md.)

## Holdout 2 (registered before T04 exists; reader frozen at 9e10138)

After the first holdout (T03) the reader was changed three times using
T03 and exploratory-style results, so those runs are no longer unseen.
Holdout 2 checks the changed reader on a new plan, T04, authored after
the freeze and run once:

| Case | Resolution | Degradation |
|---|---|---|
| clean-100 | 100 px/m | none |
| scan2-150 | 150 px/m (never used before) | −2.5° rotation (opposite sign, larger), blur σ=1.2, noise σ=18, JPEG q=50 |

Targets: the clean and scan columns above, unchanged. T04 will include
features not yet seen: a free-standing wing wall, a 100 mm nib at a
corner window, back-to-back doors on one partition, a 2.4 m window and a
1.8 m external door.
