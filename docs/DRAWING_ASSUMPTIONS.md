# Drawing Assumptions Register

One section per drawing set. **No real drawings have been received in this
repository yet.**

For plans built with plan3d, the register lives in the plan's
`dimensions` section, and `uncertainty.md` is generated from it on every
build. Sections here summarize and link to it.

## T01: Training House T01 (S-01 rev A, fictional, 2026-10-19)

- Nature: invented layout for rehearsal; same 12 × 10 m envelope as HOUSE H01,
  but H01's drawings were not used. No permission issues.
- Register: [projects/t01/plan.json](../projects/t01/plan.json) → `dimensions`
  (38 CONFIRMED, 5 INFERRED, 2 OPEN).
- INFERRED: D-011 partition 115 mm; D-020 ceiling 3.0 m; D-021/D-022 slab
  build-ups 150 mm; D-050 opening positions scaled (±25 mm).
- OPEN: D-090 plinth height; D-091 roof parapet and finish. Neither is modelled.

Rules:
- Record what the drawing states (`CONFIRMED`) separately from what we derived
  (`INFERRED`) and what is missing (`OPEN`).
- Never resolve an `OPEN` item by guessing silently. Ask the client or log it
  as `INFERRED` with a reason and its visual impact.
- Hidden structure, foundations and services are never inferred into a model
  presented as fact.

## Template

```markdown
## <Project> — <Drawing ID / title> (rev <x>, received YYYY-MM-DD)

- Drawing type: plan / elevation / section / site / brochure image
- Scale & units: 1:100, mm (stated | inferred from <dimension>)
- Datum / origin: <grid A-1 intersection, etc.>
- Ownership & permission: <client drawing, permission recorded on YYYY-MM-DD>

| ID | Item | Value | Status | Source / reasoning | Visual impact |
|----|------|-------|--------|--------------------|---------------|
| D-001 | Living room width | 4,200 mm | CONFIRMED | Dim. string on plan | — |
| D-002 | Wall thickness (internal) | 115 mm | INFERRED | Typical brick partition; not dimensioned | Low |
| D-003 | Floor-to-floor height | — | OPEN | No section supplied | High: ask client |
```
