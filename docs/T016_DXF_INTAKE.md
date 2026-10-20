# T-016: DXF plan intake (CAD vectors → draft plan.json)

Status: **pre-registration** (2026-10-20). Method, test plan and targets
were written and committed before the reader or the test files exist.

## Why

Residential architects in India mostly draw in AutoCAD. A DXF export (the
open AutoCAD exchange format; DWG can be saved as DXF) holds exact
coordinates, units, layers, door and window blocks, and room-name text.
Reading it avoids the guesswork of reading an image (T-006) and needs no
OCR. Library: ezdxf 1.4.5 (MIT, free).

## Scope of v0.1

- One floor plan per file, model space, orthogonal walls.
- Units from the file header (`$INSUNITS`: mm, cm or m); otherwise the
  reviewer gives them.
- Walls: lines and polylines on layers whose name contains `WALL` (or
  layers the reviewer names), drawn as two outlines with caps at openings.
- Openings: gaps in a wall line. Door: a block insert, or an arc, in the
  gap on a layer or block named like `DOOR`; swing side from the arc.
  Window: a block or lines in the gap on a `WIND`/`GLAZ` layer. Otherwise
  arch.
- Rooms: enclosed regions from plan3d's own layout; name from the TEXT or
  MTEXT inside; use guessed from the name (bed → bedroom, kitchen,
  toilet/bath/WC, living/hall/drawing, dining, passage/lobby → circulation).
- Everything read is a **draft**: INFERRED with a note, never CONFIRMED,
  and reviewed before building (same rule as T-006).

## Test files

There are no real DXF files yet (T-010). Test files are generated from
the fictional plans by a writer that follows common AutoCAD conventions:
walls as closed polylines per wall piece on `A-WALL` (caps across
openings); doors as a `DOOR` block (leaf and swing arc) on `A-DOOR`;
windows as a `WINDOW` block (three glazing lines) on `A-GLAZ`; room names
as TEXT on `A-AREA-IDEN`; furniture blocks on `A-FURN`; toilet floor
HATCH on `A-FLOR-PATT`; dimensions on `A-ANNO-DIMS`; units mm.

| Case | Variation |
|---|---|
| `poly` | walls as closed polylines (as above) |
| `lines` | the same walls exploded into separate LINE entities, in shuffled order |
| `hatched` | `poly` plus a wall HATCH (ANSI31) on `A-WALL-PATT` |

**Development:** T01, T02 (all three cases). **Holdout (run once, after
the reader is frozen and committed):** T03, T04, T05 and T06 ground floors
(all three cases), never written as DXF before.

## Targets (fixed before running)

| Metric | Target (every run) |
|---|---|
| Wall boundary offset | ≤ 2 mm |
| Rooms recovered (IoU ≥ 0.9) | 100% |
| Room area error (each) | ≤ 0.5% |
| Opening recall / precision | 100% / 100% |
| Opening kind accuracy | 100% |
| Door swing accuracy | 100% |
| Opening width error (mean) | ≤ 5 mm |
| Room names matched to the right room | 100% |
| Draft builds with 0 FAIL | yes |

Metrics are computed the same way as for T-006 (`bench/run.py score`),
plus the room-name check. A run that misses a target is reported as
missed; targets are not changed afterwards.

## What this will and will not show

It will show the reader handles files that follow these conventions. It
will not show how it handles real offices' drawings, whose layer names,
block styles and drafting habits vary. That needs real DXF files with
permission (T-010).

## Development results (T01, T02; reader frozen at the commit that adds this section)

| Run | Offset mm | Rooms | Max area err | Recall / precision | Kind | Swing | Width err mm | Names | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| t01/poly, lines, hatched | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 2.3 | 100% | PASS ×3 |
| t02/poly, lines, hatched | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 2.7 | 100% | PASS ×3 |

Windows read 5 mm narrow (their block's jamb lines sit at the opening ends);
doors and arches are exact.

How we got here (each from a failing development run):
1. First run: everything 5.00 mm off. Anti-aliased polygon filling made
   walls about half a pixel fatter on each side, and 2 px symbol lines
   narrowed the openings. The walls are now drawn at 4× without
   anti-aliasing and shrunk by area averaging, and symbols at 1 px.
2. The room-name register item was set to INFERRED without a number,
   which the schema rejects. Its value is now the number of rooms named.

## Holdout results (T03–T06 ground floors, 3 styles; run once at df126d4)

| Plan | Offset mm | Rooms | Max area err | Recall / precision | Kind | Swing | Width err mm | Names | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| t03 (poly, lines, hatched) | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 2.7 | 100% | PASS ×3 |
| t04 (poly, lines, hatched) | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 2.7 | 100% | PASS ×3 |
| t05 (poly, lines, hatched) | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 3.1 | 100% | PASS ×3 |
| t06 (poly, lines, hatched) | 0.00 | 100% | 0.00% | 1.00 / 1.00 | 1.00 | 1.00 | 3.3 | 100% | PASS ×3 |

**12 of 12 holdout runs pass.** This shows the reader handles any plan
drawn in these conventions, including T04's wing wall, nib and back-to-back
doors. It does **not** show real-world accuracy. Every test file came from
our own writer: the same layer names, the same door and window blocks, and
clean outlines that meet exactly. Real files will differ in layer names
(`--wall-layers` covers that), block styles, gaps and overlaps in outlines,
curved walls and text placement. Status: IMPLEMENTED, VERIFIED on
convention-following files only; real DXF files are needed (T-010).

## Exploratory: untidy line ends (not pre-registered)

Real files rarely have ends that meet exactly. Two extra styles: `gappy`
(each wall line's ends pulled back 0–5 mm) and `overshoot` (pushed out
0–20 mm). The frozen reader failed `gappy` completely (no closed
outlines). Fix: every wall line is extended by 10 mm at both ends before
noding, so near-misses meet; overshoots only leave loose ends, which drop
out when faces are built. After the fix: T01–T06 × both styles 12/12 PASS,
and all 18 pre-registered runs still PASS.

Third exploratory style, `columns`: RCC columns (closed polylines with a
solid hatch on `S-COLS`) at every wall end and junction, with the wall
outlines stopping at the column faces, as in framed buildings (common in
India). Frozen reader: 0/6 (the outlines do not close without the
columns). Fix: column layers (`COLUMN`, `COLS`) count as wall outlines.
After: 6/6, and all other 30 runs still pass (36/36).

## Part 2: multi-storey sheets and stairs (registered 2026-10-20, before any code)

Real drawing sets put the ground and first floor plans side by side in one
file, each titled ("GROUND FLOOR PLAN", "FIRST FLOOR PLAN"), with the stair
drawn as tread lines on a stair layer, an arrow and the word UP.

**Method.** Split the wall faces into separate plans (clusters more than
2 m apart). Order them by their title text (ground, first, second, ...;
otherwise left to right). Align each plan on its outer south-west corner,
and stack the levels with the reader's default heights. Read each stair
from its layer (`STAIR`/`STRS`):
- tread lines parallel to each other, the same length (the width);
- straight (one run) or dog-leg (two runs side by side, a landing between);
- climbing direction from the UP text or the arrow's start;
- risers = treads + 1 per flight.

The riser height then follows from the levels.

**Test files.** The writer gains a `sheet` style: every level of a plan,
side by side, 3 m apart, titled, with the stair on the lower level drawn
on `A-FLOR-STRS` (tread lines, a walking line with an arrow, UP) and the
opening on the upper level as a dashed outline. Also the `poly` wall
style for the rest.

**Development:** T05 (straight stair). **Holdout (run once, frozen):**
T06 (dog-leg).

**Targets (per level, as part 1, plus):** level count right; stair type,
direction, width (± 5 mm), risers (exact), going (± 5 mm) and start (± 10 mm)
right; draft builds with 0 FAIL, including Q09 (upper rooms reached by
the stair), Q21 and Q22.

**Honest limit:** with one development plan and one holdout plan by the
same author, a pass shows the method works on these conventions, not that
it generalises.

### Part 2 development result (T05; reader frozen at the commit that adds this)

| Run | Result |
|---|---|
| t05 ground floor | offset 0.00 mm, rooms 100%, area 0.00%, openings 100% / 100%, width 3.1 mm, names 100%: PASS |
| t05 first floor | offset 0.00 mm, rooms 100%, area 0.00%, openings 100% / 100%, width 3.6 mm, names 100%: PASS |
| t05 stair | straight, N, 18 risers, width 1.000, going 0.250, start (7.27, 0.60): exact. PASS |
| draft build | 0 FAIL (Q09 reaches the upper rooms by the stair; Q21, Q22 pass) |

First run, no changes needed. Part 1 runs unchanged (18/18).

### Part 2 holdout (T06, dog-leg; run once at 6f545ca)

| Run | Result |
|---|---|
| t06 ground floor | offset 0.00 mm, rooms 100%, area 0.00%, openings 100% / 100%, width 3.3 mm, names 100%: PASS |
| t06 first floor | offset 0.00 mm, rooms 100%, area 0.00%, openings 100% / 100%, width 3.6 mm, names 100%: PASS |
| t06 stair | dog-leg, N, turn right, 18 risers (9 + 9), width 1.000, going 0.250, start (7.27, 3.00): exact. PASS |
| draft build | 0 FAIL |

**Holdout passed on the first and only run.** Same caveat as before: one
development and one holdout plan, written by our own writer with its
conventions (titles, a stair layer, UP text). Real sheets also hold
elevations, sections, site plans and title blocks, and draw stairs in many
ways. That needs real files (T-010).
