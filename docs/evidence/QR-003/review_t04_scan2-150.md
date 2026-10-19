# Review sheet: Draft read from t04_scan2-150.jpg

Draft produced by the plan reader. **Nothing here is confirmed.** Check every line against
the drawing, correct `plan.json`, then build with `python -m plan3d build`.

## Reading

- Scale: 150.0117 px/m; skew corrected: 2.5°
- Found 10 walls, 15 openings, 6 rooms
- Wall thickness types: WT240 = 240 mm, WT235 = 235 mm, WT225 = 225 mm, WT120 = 120 mm

## Openings

| ID | Wall | Kind | Width (mm) | Opens into |
|---|---|---|---|---|
| O01 | W01 | window | 1180 | - |
| O02 | W01 | window | 580 | - |
| O03 | W01 | window | 1480 | - |
| O04 | W02 | door | 745 | R01 |
| O05 | W03 | arch | 900 | - |
| O06 | W05 | door | 1800 | R06 |
| O07 | W06 | window | 1480 | - |
| O08 | W06 | window | 2380 | - |
| O09 | W07 | door | 900 | R02 |
| O10 | W08 | arch | 1600 | - |
| O11 | W09 | door | 745 | R01 |
| O12 | W09 | door | 900 | R03 |
| O13 | W10 | window | 1180 | - |
| O14 | W10 | window | 1480 | - |
| O15 | W10 | window | 1180 | - |

## Rooms (names and uses not read: fill in)

| ID | Area m² | Area sq ft |
|---|---|---|
| R01 | 2.94 | 32 |
| R02 | 14.36 | 155 |
| R03 | 10.30 | 111 |
| R04 | 2.15 | 23 |
| R05 | 11.54 | 124 |
| R06 | 20.28 | 218 |

## Always confirm

- Window sills and heights, door and arch heights, ceiling height (defaults; not on a plan)
- Room names and uses
- Any opening the overlay shows in the wrong place or of the wrong kind
