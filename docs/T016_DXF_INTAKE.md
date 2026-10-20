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
