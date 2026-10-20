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
