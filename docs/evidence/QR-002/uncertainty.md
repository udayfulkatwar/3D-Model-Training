# Uncertainty report: Training House T01

Nature: fictional training plan. Generated 2026-10-19.

Visualization model only. Not for construction. Automated checks are sanity checks, not UDCPR/NBC/BIS compliance.

## Inferred values (in the model, need confirmation)

| ID | Item | Value | Reason | Used by |
|---|---|---|---|---|
| D-011 | Internal partition thickness | 0.115 | Partitions not dimensioned on S-01; assumed half-brick 115 mm | wall_types.INT, walls.W05, walls.W06, walls.W07, walls.W08, walls.W09 (+2 more) |
| D-020 | Floor to ceiling height | 3 | No section supplied; typical residential value assumed | levels.L00 |
| D-021 | Floor build-up below FFL | 0.15 | Visual only; no structural meaning | levels.L00 |
| D-022 | Roof slab thickness | 0.15 | Visual only; no structural meaning | levels.L00 |
| D-050 | Opening positions along walls: scaling uncertainty | 0.025 | Openings are not dimensioned on S-01; positions scaled from the drawing (expect +/-25 mm) | openings.O01, openings.O02, openings.O03, openings.O04, openings.O05, openings.O06 (+9 more) |

## Open questions (not in the model)

| ID | Item | Value | Reason | Used by |
|---|---|---|---|---|
| D-090 | Plinth height above finished ground | - | Not on S-01; ground and steps are not modelled until answered | - |
| D-091 | Roof parapet height and finish | - | Not on S-01; roof is a flat slab without parapet until answered | - |
