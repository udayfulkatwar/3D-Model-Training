# QA report: Training House T05 (G+1)

**No blocking failures.** PASS 13 · INFO 9 · WARN 0 · FAIL 0

Visualization model only. Not for construction. Automated checks are sanity checks, not UDCPR/NBC/BIS compliance.

| ID | Check | Status |
|---|---|---|
| Q01 | Schema valid | PASS |
| Q02 | Unique ids and valid references | PASS |
| Q03 | Provenance: no geometry depends on an OPEN item | INFO |
| Q04 | Wall sanity | PASS |
| Q05 | Envelope closed | PASS |
| Q06 | Rooms resolve to unique enclosed regions | PASS |
| Q07 | Openings fit their walls | PASS |
| Q08 | Plan conformance: geometry matches the dimension register | INFO |
| Q09 | Circulation: every room reachable through doors and stairs | PASS |
| Q18 | Door swing clearance (each door can open 90 degrees) | PASS |
| Q21 | Levels stack; stairs fit and climb comfortably | INFO |
| Q10 | Daylight/ventilation sanity (not a code check) | INFO |
| Q11 | Solids are closed, finite and positive-volume | PASS |
| Q12 | No degenerate faces (< 1e-05 m^2) | PASS |
| Q13 | No coplanar overlapping faces between parts (z-fighting) | INFO |
| Q14 | 3D floor areas equal 2D room areas (less stair openings) | PASS |
| Q19 | Walk tests: doors and arches passable, walls and glass blocking | INFO |
| Q20 | Clear walking width through doors and arches | INFO |
| Q22 | Stair headroom (2.0 m above every tread) | INFO |
| Q15 | Every exported mesh has UVs | PASS |
| Q16 | GLB re-import matches what was built | PASS |
| Q17 | FBX re-import matches what was built | INFO |

### Q03 Provenance: no geometry depends on an OPEN item

- [INFO] 6 INFERRED dimension(s) in use: D-020, D-021, D-022, D-055, D-095, D-096 (see uncertainty report)

### Q08 Plan conformance: geometry matches the dimension register

- [INFO] 39 dimension checks evaluated

### Q21 Levels stack; stairs fit and climb comfortably

- [INFO] S01: 18 risers of 175.0 mm, going 250 mm, 2R+G = 600 mm, run 4.250 m
- [INFO] S01: R01 -> R11, landing 1.093 m deep

### Q10 Daylight/ventilation sanity (not a code check)

- [INFO] R01: glazing 3.24 m^2 = 7.5% of floor area
- [INFO] R02: glazing 1.80 m^2 = 13.1% of floor area
- [INFO] R03: glazing 2.70 m^2 = 19.6% of floor area
- [INFO] R11: glazing 1.08 m^2 = 17.0% of floor area
- [INFO] R12: glazing 3.24 m^2 = 9.0% of floor area
- [INFO] R13: glazing 3.60 m^2 = 12.9% of floor area

### Q13 No coplanar overlapping faces between parts (z-fighting)

- [INFO] 157 face pair(s) where touching solids meet back to back (hidden, expected)

### Q19 Walk tests: doors and arches passable, walls and glass blocking

- [INFO] 31/31 probes as expected

### Q20 Clear walking width through doors and arches

- [INFO] Clear widths: door:O01 0.845 m, door:O04 0.745 m, door:O05 0.745 m, door:O11 0.745 m, door:O12 0.745 m

### Q22 Stair headroom (2.0 m above every tread)

- [INFO] S01: 17 treads and landings checked

### Q17 FBX re-import matches what was built

- [INFO] FBX header: UnitScaleFactor=1.000000 (cm), UpAxis=1, FrontAxis=2; coordinates stored at 100x metres
