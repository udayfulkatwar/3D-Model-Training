# Drawing Assumptions Register

One section per drawing set. **No drawings have been received in this
repository yet.**

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
