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

Every run in order, with no runs left out. Generated from the files in
[evidence/QR-003](evidence/QR-003/). "Openings found · correct kind" counts
truth openings matched within 0.3 m, then how many of those had the right kind.

| Stage | Run | Wall offset mm | Rooms | Max area err | Openings found / correct kind | Swing | Width err mm | Builds | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Dev, first run | t01/clean-100 | 5.00 | 8/8 | 0.62% | 13/15 · 13 | 1.00 | 9.2 | yes | MISS: recall, precision |
|  | t01/clean-60 | 5.50 | 6/8 | 1.55% | 12/15 · 12 | 1.00 | 10.0 | yes | MISS: rooms, recall, precision |
|  | t01/scan-100 | 177.28 | 0/8 | - | 0/15 · 0 | - | - | no | MISS: offset, rooms, area, recall, precision, kind, width, builds |
|  | t02/clean-100 | 1.80 | 5/5 | 0.35% | 11/11 · 11 | 1.00 | 10.9 | yes | PASS |
|  | t02/clean-60 | 5.32 | 3/5 | 0.28% | 8/11 · 8 | 1.00 | 15.0 | no | MISS: rooms, recall, precision, builds |
|  | t02/scan-100 | 221.35 | 0/5 | - | 0/11 · 0 | - | - | no | MISS: offset, rooms, area, recall, precision, kind, width, builds |
| T03 holdout 1 (reader b6cb497, first run) | t03/clean-100 | 5.16 | 9/9 | 0.36% | 20/20 · 20 | 1.00 | 11.0 | yes | PASS |
|  | t03/clean-60 | 2.36 | 9/9 | 0.65% | 20/20 · 19 | 1.00 | 11.0 | no | MISS: kind, builds |
|  | t03/scan-100 | 5.26 | 9/9 | 0.58% | 20/20 · 20 | 1.00 | 13.2 | yes | PASS |
| Dev + T03 after post-holdout fixes (9e10138) | t01/clean-100 | 1.15 | 8/8 | 0.51% | 15/15 · 15 | 1.00 | 9.3 | yes | PASS |
|  | t01/clean-60 | 4.80 | 8/8 | 1.55% | 15/15 · 15 | 1.00 | 9.3 | yes | PASS |
|  | t01/scan-100 | 1.15 | 8/8 | 0.51% | 15/15 · 15 | 1.00 | 9.3 | yes | PASS |
|  | t02/clean-100 | 1.80 | 5/5 | 0.35% | 11/11 · 11 | 1.00 | 10.9 | yes | PASS |
|  | t02/clean-60 | 3.81 | 5/5 | 0.45% | 11/11 · 11 | 1.00 | 10.9 | yes | PASS |
|  | t02/scan-100 | 1.80 | 5/5 | 0.35% | 11/11 · 11 | 1.00 | 10.9 | yes | PASS |
|  | t03/clean-100 | 0.19 | 9/9 | 0.29% | 20/20 · 20 | 1.00 | 11.0 | yes | PASS |
|  | t03/clean-60 | 2.36 | 9/9 | 0.65% | 20/20 · 20 | 1.00 | 11.0 | yes | PASS |
|  | t03/scan-100 | 0.30 | 9/9 | 0.29% | 20/20 · 20 | 1.00 | 11.2 | yes | PASS |
| Exploratory styles (9e10138; used for tuning) | t01/clean-80 | 4.60 | 8/8 | 1.03% | 15/15 · 15 | 1.00 | 7.0 | yes | PASS |
|  | t01/thickpen-100 | 1.76 | 8/8 | 0.51% | 15/15 · 15 | 1.00 | 16.3 | yes | PASS |
|  | t01/thickpen-scan-100 | 1.76 | 8/8 | 0.51% | 15/15 · 15 | 1.00 | 18.7 | yes | PASS |
|  | t02/clean-80 | 0.00 | 5/5 | 0.00% | 11/11 · 11 | 1.00 | 8.2 | yes | PASS |
|  | t02/thickpen-100 | 2.86 | 5/5 | 0.35% | 11/11 · 11 | 1.00 | 16.4 | yes | PASS |
|  | t02/thickpen-scan-100 | 2.86 | 5/5 | 0.35% | 11/11 · 11 | 1.00 | 19.5 | yes | PASS |
|  | t03/clean-80 | 0.28 | 9/9 | 0.36% | 20/20 · 20 | 1.00 | 8.2 | yes | PASS |
|  | t03/thickpen-100 | 1.36 | 9/9 | 0.58% | 20/20 · 20 | 1.00 | 19.3 | yes | PASS |
|  | t03/thickpen-scan-100 | 1.36 | 9/9 | 0.58% | 20/20 · 20 | 1.00 | 23.0 | yes | PASS |
| T04 holdout 2 (reader 9e10138, first run) | t04/clean-100 | 1.70 | 6/6 | 0.71% | 15/15 · 15 | 1.00 | 10.7 | yes | PASS |
|  | t04/scan2-150 | 3.19 | 6/6 | 0.93% | 15/15 · 15 | 1.00 | 11.3 | yes | PASS |

### Reading the history honestly

1. **First run: 1/6.** Causes were diagnosed, not tuned around: a deskew
   method that cannot see small rotations, horizontal and vertical walls
   grouped together when their pixel positions happened to coincide,
   dropped wall nibs and short walls, broken glazing lines in scans, and a
   connectivity rule stricter than the end-snapping rule.
2. **Holdout 1 (T03), first run: 2/3.** At 60 px/m a dashed arch was read
   as a window (a fixed 4 px gap bridge closed 4 px dash gaps). The
   wrong kind cut the corridor off, and plan3d's circulation check
   failed the draft rather than passing it silently.
3. **Post-holdout fixes.** The exploratory thick-pen style exposed two
   real bugs (even-sized kernels shift masks by 1–2 px; a fixed
   pen-width multiple deletes 100 mm walls). After fixing them, every dev,
   T03 and exploratory run passes, **but all of these were used for
   tuning.**
4. **Holdout 2 (T04), first run: 2/2.** A new plan with new features (wing
   wall, 100 mm corner nib, 2.4 m window, 1.8 m door), plus a resolution
   and skew never used before. This is the best available evidence for
   unseen *synthetic* drawings.

### What this does and does not show

- It shows the reader handles this drawing style (filled walls,
  CAD-like symbols) across 60–150 px/m, ±2.5° skew, blur, noise and JPEG,
  on four different layouts.
- It does **not** show performance on real drawings. Every test drawing
  comes from one renderer, so real CAD exports, hand-drafted plans,
  hatched or hollow walls, text over walls, furniture blocks drawn
  thick, and photos with perspective are all untested. The next step is
  a small set of real drawings the company owns or has permission to use,
  with the truth measured by hand.
- Known bias: window widths read about 20 mm narrow, because jamb lines
  sit at the wall ends. Doors and arches show no bias.

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

## Hollow walls (T-011 part 1): registered 2026-10-20, before any code

Most CAD-exported plans draw walls as **two outlines** (hollow), not
filled. The v0.1 reader cannot read them. Plan: fill the inside of each
wall outline before the existing pipeline runs. Thin white regions that
are long, and that do not touch another thin region, are wall interiors.
Window glazing strips and floor hatching come in touching groups, so they
are left alone.

**Drawing style.** The bench renderer gains a `hollow` style: each wall
is drawn as its outline, closed across each opening's jambs, with a 1.5×
pen. Everything else (clutter, symbols, text) is unchanged.

**Development:** T01 and T02, cases `hollow-clean-100`, `hollow-clean-60`
and `hollow-scan-100` (the same resolutions and degradation as above).

**Holdout (run once, after development is frozen and committed):** T03 and
T04, cases `hollow-clean-100` and `hollow-scan2-150` (Holdout 2's
degradation). T03 and T04 have never been read in hollow style.

**Targets:** the clean and scan columns above, unchanged. The existing
filled-wall runs (`python -m bench.run`, `--holdout2` on T04) must not get
worse on any metric.

### Hollow walls: development results (T01, T02; reader frozen at the commit that adds this section)

| Run | Offset mm | Rooms | Max area err | Recall / precision | Kind | Swing | Width err mm | Verdict |
|---|---|---|---|---|---|---|---|---|
| t01/hollow-clean-100 | 1.15 | 100% | 0.51% | 1.00 / 1.00 | 1.00 | 1.00 | 0.0 | PASS |
| t01/hollow-clean-60 | 6.11 | 100% | 1.55% | 1.00 / 1.00 | 1.00 | 1.00 | 7.3 | PASS |
| t01/hollow-scan-100 | 1.35 | 100% | 0.14% | 1.00 / 1.00 | 1.00 | 1.00 | 2.3 | PASS |
| t02/hollow-clean-100 | 1.81 | 100% | 0.53% | 1.00 / 1.00 | 1.00 | 1.00 | 0.0 | PASS |
| t02/hollow-clean-60 | 5.90 | 100% | 0.80% | 1.00 / 1.00 | 1.00 | 1.00 | 7.7 | PASS |
| t02/hollow-scan-100 | 3.41 | 100% | 0.54% | 1.00 / 1.00 | 1.00 | 1.00 | 1.4 | PASS |

All 20 filled-wall runs (development, exploratory, T03, holdout 2) are
unchanged on every metric.

How we got here, in order (each step from a failing development run):
1. Before any change: 0/6; nothing read.
2. Fill thin, long white regions: rooms were taken as thin because the
   median width is pulled down by gaps around furniture. Width = widest
   inscribed circle instead.
3. Renderer fix (before any holdout run): hatching and furniture were
   drawn across hollow walls, cutting their insides apart. In the filled
   style this is invisible (black on black). Hollow walls now cover what
   lies beneath them, as CAD hatch boundaries do.
4. A 150 mm pier between a door and a window is not "long". Small regions
   that continue a found wall band on the same rows are piers.
5. Skewed scans: fill, measure skew, rotate the original, fill again (piers
   need level bands).
6. Outline pen: outlines are centred on the wall faces, so filled walls are
   a pen too thick and openings a pen too narrow. The pen is measured as
   summed darkness across the outlines (blur-proof; 2.25 px at 100 px/m,
   the drawn value), and taken off before openings are classified. A
   wardrobe line along a wall face was otherwise read as glazing.
7. Thick-pen filled drawings tripped the hollow test. Hollow mode now needs
   more wall inside than solid wall-thick ink (separation ≥ 10×).

### Hollow walls: holdout results (T03, T04; run once at c4393b6)

| Run | Offset mm | Rooms | Max area err | Recall / precision | Kind | Swing | Width err mm | Verdict |
|---|---|---|---|---|---|---|---|---|
| t03/hollow-clean-100 | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 0.0 | PASS |
| t03/hollow-scan2-150 | 3.68 | 100% | 0.63% | 1.00 / 1.00 | 1.00 | 1.00 | 4.5 | PASS |
| t04/hollow-clean-100 | 1.60 | 100% | 0.78% | 1.00 / 1.00 | 1.00 | 1.00 | 0.0 | **MISS** (draft does not build: Q07) |
| t04/hollow-scan2-150 | 1.45 | 100% | 0.60% | 1.00 / 1.00 | 1.00 | 1.00 | 3.0 | PASS |

**3 of 4 holdout runs pass.** All geometry and opening metrics are within
target on all four. The miss: a door leaf (a filled 35 mm rectangle) lies
next to a parallel furniture line. The white strip between them is thin,
long and alone, so it was filled as a 0.67 m wall. That false wall cuts
into a real one, and the draft fails Q07. A reviewer would see it on the
overlay; the build refuses it.
