# QA report: Training House T01

**No blocking failures.** PASS 12 · INFO 2 · WARN 2 · FAIL 0

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
| Q08 | Plan conformance: geometry matches the dimension register | WARN |
| Q09 | Circulation: every room reachable through doors | PASS |
| Q10 | Daylight/ventilation sanity (not a code check) | WARN |
| Q11 | Solids are closed, finite and positive-volume | PASS |
| Q12 | No degenerate faces (< 1e-05 m^2) | PASS |
| Q13 | No coplanar overlapping faces between parts (z-fighting) | INFO |
| Q14 | 3D floor areas equal 2D room areas | PASS |
| Q15 | Every exported mesh has UVs | PASS |
| Q16 | GLB re-import matches what was built | PASS |

### Q03 Provenance: no geometry depends on an OPEN item

- [INFO] 5 INFERRED dimension(s) in use: D-011, D-020, D-021, D-022, D-050 (see uncertainty report)

### Q08 Plan conformance: geometry matches the dimension register

- [WARN] D-090 OPEN: Plinth height above finished ground
- [WARN] D-091 OPEN: Roof parapet height and finish
- [INFO] 42 dimension checks evaluated

### Q10 Daylight/ventilation sanity (not a code check)

- [INFO] R01: glazing 1.80 m^2 = 7.8% of floor area
- [INFO] R02: glazing 1.80 m^2 = 12.3% of floor area
- [INFO] R03: glazing 1.26 m^2 = 8.1% of floor area
- [INFO] R04: glazing 1.80 m^2 = 8.9% of floor area
- [INFO] R05: glazing 0.36 m^2 = 9.2% of floor area
- [WARN] R06 (Toilet 2): no external window; needs mechanical ventilation (confirm with architect)
- [INFO] R07: glazing 1.80 m^2 = 16.0% of floor area
- [INFO] R08: glazing 1.80 m^2 = 13.6% of floor area

### Q13 No coplanar overlapping faces between parts (z-fighting)

- [INFO] 64 face pair(s) where touching solids meet back to back (hidden, expected)
