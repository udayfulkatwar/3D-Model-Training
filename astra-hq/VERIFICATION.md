# Verification results

Run on 2026-10-24 in a cloud container. Raw results: [docs/e2e-results.json](docs/e2e-results.json),
[docs/perf-swiftshader.json](docs/perf-swiftshader.json); screenshots in [docs/screenshots/](docs/screenshots/).

## Tested environment

| Item | Value |
|---|---|
| Machine | Cloud container, 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, **no GPU** |
| Node / npm | 22.22.0 / 10.9.4 |
| Browser | Chromium 141.0.7390.37, headless, driven by playwright-core 1.55 |
| WebGL | SwiftShader (software rasteriser) |
| Build | `npm run build` (tsc + vite 8), production `dist/` served locally |

**Not tested:** the target laptop (Ryzen 7 4000-series, RTX 3050 4 GB, 8 GB RAM), any real GPU, Firefox or Safari,
real touch hardware. No frame-rate claim is made for real hardware.

## Commands and outcomes

| Command | Result |
|---|---|
| `npm install` | OK, 0 vulnerabilities reported |
| `npm run build` | OK. Chunks (gzip): app 89 kB, react 64 kB, three + r3f 272 kB, post-processing 156 kB (lazy, High preset only), CSS 4 kB |
| `npm test` | **83/83 passed** (11 files) |
| `npm run e2e` | **79/79 passed** (viewport 960×570, Low preset for responsiveness under software rendering) |

### Unit tests (`tests/`)

- **world.test.ts (13)** — required rooms per floor; every door sits inside a wall on the same line; workstation and
  monitor counts (10×3, 5×2, …, reception 2) and unique monitor IDs; furniture inside rooms and clear of walls; every
  seat has a walkable approach reachable from reception; every room reachable from reception across floors; routes use
  the stairs and stay on walkable cells; paths prefer open doors; spawn is free; walls and closed doors stop the player;
  open doors let the player through; the stair climb reaches the first floor; the player cannot step into the top-floor
  stair void.
- **sim.test.ts (12)** — exactly 30 employees with the required role mix and valid desks/monitors; a full simulated day
  (06:30-18:00) with seat-occupancy and walkable-ground invariants checked every 2.5 simulated seconds; briefing attended
  in person; incident with the tech team in the server room; staggered lunch; breach → alert → acknowledgement → review
  with the PM → de-risking → alert closed; activity history for everyone; no route failures; server-room door opened and
  closed by staff; trader positions = book positions, book P&L = sum of trader P&L, gross/notional/firm totals agree;
  every assigned monitor builds a role view and trader blotter symbols appear in the PM view; pause freezes everything;
  5× runs five times faster; same seed → same day; reset restarts; rollover into day 2.
- **config.test.ts (7)** — defaults valid; JSON round-trip; malformed JSON rejected without throwing; oversized file
  rejected; field-level error messages (duplicate desk/id, bad role, empty name, bad colour, unknown workstation, empty
  company name); wrong top-level shapes rejected; role/desk/name edits change apps, books and seats in the simulation.

- **owner.test.ts (6)** — owner calls all 30 to the Conference Room and all 30 are physically present (18 chairs + standing
  room) with no seat conflicts, then End meeting sends them back; standing all-hands in the lobby (30/30); "Come to me" for
  a whole department brings them in front of the owner and "Back to desks" releases them; "Send to room"; an assigned task
  is worked on and reported back ("Done: …"); replies use live data (P&L, risk, research draft, location); the CEO stands
  to greet the owner entering the office, stays standing until the owner sits, then sits, and does not greet again during
  the same visit.

- **day.test.ts (8)** — the day starts with nobody in the building; all 30 badge in at the entrance (briefing attendees
  before 08:00) and are on site by 10:00; staggered role-based hours; employees ride the lift (wait, board, ride with the
  car, never more than 6, all trips finished); more than 15 people take restroom breaks in the ground-floor restrooms;
  seat invariants hold all day; everyone has badged out and the building is empty by 19:25; restroom spots are walkable;
  lift doors re-open for someone in the doorway; the real-time clock runs one simulated minute per real minute.

- **training.test.ts (8)** — the grid search picks the in-sample best and validates it on unseen sessions; some
  strategies pass and some fail; all 10 traders go through the lab; Training Room sessions (≤12, no double booking,
  traders after the close) raise skill; the CEO report and end-of-day report; records survive reloads.
- **live.test.ts (3)** — Co-Invest payload parsing; switching to live instruments re-keys the books and sizes positions
  at live prices; the live lab forward test is suspended after losing round trips.
- **workflow.test.ts (4)** — two full days: research ideas flow researcher → PM → trader; fat-finger errors are blocked
  or unwound with the cost booked; work mistakes lead to coaching; the CEO report shows it.
- **world-markets.test.ts (2)** — exchange sessions across time zones, lunch breaks, weekends and the US daylight-saving
  change; a world markets screen in each of the ten rooms.

- **research.test.ts (5)** — no look-ahead, costs on every change, engine self-test, edge found in a persistent series and
  noise rejected out of sample, stress test, regime/volatility, Co-Invest candle parsing (forming bar dropped).
- **work.test.ts (6)** — the real office on an accelerated clock with test candles: 24/7 on site, CEO objectives,
  org chart and senior-assigned tasks for all 30, reports and reviews, strategy tests → Risk → PM → paper trades,
  reconciliation with zero breaks, kill switch, persistence.

### Browser acceptance (`e2e/run.mjs`)

All 79 checks passed, including:

- Chairman's Office (second floor, east of Portfolio Management): the door carries the brass plate "Uday Fulkatwar · Chairman · ASTRA" on the leaf itself, with no sign above that door; all 22 rooms reachable.
- Chairman's PC on the cabin desk: using it opens the console listing every person with their screens, every room and wall display, rooms and records, plus all owner tabs; a staff screen opened from it has a "‹ Chairman's PC" button back.

- Loads with *Office Simulation* / *Simulated Data* labels; 30 employees; Enter Office → walkthrough (pointer lock was granted in headless Chromium); spawn at reception.
- The day starts with an empty building; the real-time clock option runs 1 simulated minute per real minute; by 07:50 staff have badged in at the entrance and reached their floors, some by lift (screenshot `19-morning-arrivals.png`).
- Keyboard movement; collision stops at the reception desk (z = 14.76, desk edge 14.45 + radius) and the exterior wall; position stays valid.
- Closed door blocks; `E` with the crosshair on the door opens it; the player walks through.
- Stairs: flight A to the mid landing (y = 2.00), flight B to the first floor (y = 4.00).
- Elevator: walk in, choose floor 2 on the car panel, ride to y = 8.00, walk out.
- Overview cutaway for floors G/1/2 hides the floors above.
- Directory search; typing in the search box does not move the player; Go to Employee lands 2.8 m from the employee.
- Profile shows task/activity/department/workstation; Inspect Monitors, Go to Desk and Follow work.
- Monitor panel: switching a tab switches the in-world monitor (same state, redrawn tab verified); switching monitors at the workstation; all 69 assigned monitors run role applications.
- At 08:12 the Conference Room display shows the briefing *IN USE* with 16/16 attendees present.
- The 13:35 simulated sell-off produced a drawdown alert, a review in Meeting Room 1B including the book's PM, and the risk app shows the alert lifecycle.
- Pause freezes the clock; 5× speed; Reset restarts the day (clock, trades, alerts).
- Sit in a boardroom chair (seated view) and stand up; coffee machine interaction; CEO desk opens the company overview.
- Editor: company name, rename and desk swap survive a page reload; export produces valid JSON; malformed and schema-invalid imports are rejected with messages and the previous configuration kept; a valid import applies; Restore defaults works.
- Teleport to every one of the 21 rooms yields a valid standing spot on the right floor.
- Mobile emulation (412×860, touch): the on-screen joystick moves the player.
- Owner tools: `O` opens the Owner panel; calling everyone to the Conference Room gets 30/30 in the room; a typed question gets a live-data reply; "Come to me" brings the trader to within 1.3 m; the CEO stands to greet and sits once the owner sits.
- Training: the owner starts the programme, all 10 traders finish the strategy lab, the CEO report and Workflow tab render.
- Live mode with a stubbed claude.ai runtime: real instrument symbols with feed prices, LIVE chip, only read-only Co-Invest tools called, market wall shows headlines; a (stub) Claude reply's `go_to_room` tool call sends the employee to the Boardroom.
- No uncaught page errors or console errors; **no network requests to any host other than the local server**.

## Performance measurements (what could be measured)

| Measurement | Low | Medium | High |
|---|---|---|---|
| Draw calls, trading floor walkthrough view (all passes) | 129 | 146 | 274 (incl. shadow + post passes) |
| Triangles rendered per frame (all passes) | 199k | 200k | 401k |
| Frame rate under SwiftShader | ~1 fps | ~1 fps | ~1 fps |

- Full exterior overview: ~530 draw calls, ~294k triangles (all three floors + city).
- CPU profile during the walkthrough (6 s, Chromium main thread): **~97 % idle**; the software rasteriser in the GPU
  process is the bottleneck, so the frame rates above say nothing about real GPUs.
- Building and drawing one monitor screen from the simulation: **~0.26-0.38 ms** of main-thread time (256-512 px
  canvases); the per-frame budget is 1/2/3 screens on Low/Medium/High.

These numbers are consistent with an interactive frame rate on a discrete laptop GPU, but that has **not** been
measured. On the target RTX 3050 laptop, enable *Settings → Simulation → FPS & renderer statistics* and start with
the Medium preset.

## Screenshots (headless, software rendering, 960×570)

| | |
|---|---|
| Reception — `02-reception.png` | Trading floor — `09-trading-floor.png` |
| Market wall — `10-market-wall.png` | Café at lunch — `11-cafe-lunch.png` |
| Boardroom — `12-boardroom.png` | Monitor inspection — `06-monitor-inspection.png` |
| Morning briefing — `07-conference-briefing.png` | Seated view — `08-boardroom-seated.png` |
| Exterior — `01-intro-exterior.png` | Night overview — `13-night-overview.png` |
| Floor cutaways — `04-…`, `05-…` | Mobile — `14-mobile.png` |

## Observations from the runs

- Under software rendering at ~1 fps, an in-world screen can lag the open panel by a simulated minute or two
  (e.g. screenshot 06: screen drawn 08:06, panel 08:08) because the screen redraw is tied to rendered frames while the
  test advanced the clock directly. The tab state is shared and was verified to match.
- Interaction and movement tests needed long waits because each rendered frame took 0.3-1 s in software.
