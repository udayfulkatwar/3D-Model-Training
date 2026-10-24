# ASTRA Headquarters — Office Simulation

An interactive, frontend-only 3D office simulation of a fictional investment firm's three-floor
headquarters. Walk the building, visit every room, approach any of the 30 employees, inspect their desks
and monitors, and watch a seeded office day unfold: trading, research, meetings, café breaks, a simulated
risk-limit breach and a technology incident.

**Everything is simulated.** People are fictional, editable placeholders; every price, position, P&L and
metric is labelled *Simulated Data* and produced by a local seeded model. There is no backend, no
authentication, no paid API, no real trading and no monitoring of real people.

![Reception](docs/screenshots/02-reception.png)

## Quick start

Requirements: Node.js 20+ (tested with Node 22.22.0, npm 10.9.4) and a browser with WebGL 2.

```bash
cd astra-hq
npm install          # install dependencies
npm run dev          # development server at http://localhost:5173
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build at http://localhost:4173
npm test             # unit tests (vitest): layout, navigation, simulation, configuration
npm run e2e          # browser acceptance checks against dist/ (needs a Chromium; see below)
```

`dist/` is a static site (relative paths) and can be hosted from any static file server or sub-folder.

The browser checks use `playwright-core` with the Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
set `CHROMIUM_PATH` to use another Chromium build. They run on SwiftShader (software GL), so they verify
behaviour, not frame rate.

## Controls

| Input | Action |
|---|---|
| **Enter Office** | Start the first-person walkthrough (requests pointer lock) |
| `W A S D` / arrows, `Shift` | Move, move faster |
| Mouse (or drag with left button if pointer lock is unavailable) | Look |
| `E` / click | Interact with what is under the crosshair: doors, monitors, wall displays, chairs, coffee machines, elevator buttons, CEO desk, people |
| `Esc` | Release the cursor / close the open panel |
| `F` | Employee directory (search, Go to, Profile) |
| `N` | Floors & rooms navigation, Return to Reception |
| `M` | Toggle building overview; `1`-`4` pick a floor cutaway |
| `P` | Pause / resume the simulation |
| `L` | Toggle employee labels |
| `O` / **Owner** button | Owner tools: call a meeting with everyone, departments or picked people in any room; call people to you; send them to a room; read replies |
| `E` on a person | Talk to them (in person when close, by phone otherwise); ask questions, give instructions, assign tasks |
| Touch | Left joystick moves, drag on the right half looks, ● interacts |

Movement input is ignored while a panel is open or a text field has focus.

## What's inside

**Building** (original design, 34 × 19.6 m, three floors at 4.0 m floor-to-floor, 3.2 m clear ceilings,
2.4 m corridors, dog-leg stair with 11 risers per flight, elevator serving all floors):

| Floor | Rooms |
|---|---|
| Ground | Entrance plaza & canopy signage, Reception & Lobby (reception desk with 2 monitors, logo wall, directory kiosk), Visitor Lounge, Café (counter, coffee machine, display fridge, 4 tables, window bar, armchairs), Interview Room, Training Room, Restrooms A & B, Utility & Storage |
| First | Trading Floor (10 desks × 3 monitors, market display wall), Research Area (5 desks × 2 monitors, collaboration table, 2 flex desks), Risk Management (3 desks), Meeting Rooms 1A & 1B, Conference Room (18 seats) |
| Second | Founder / CEO Office, Portfolio Management (3 desks), Technology (4 desks), Operations (2 desks), Boardroom (16 seats), Staff Lounge, glass-enclosed Server Room |

**Simulation** (`src/sim/`): one clock (1 real second = 20 simulated seconds at 1×; 2× and 5× available, or a
real-time clock option where one simulated minute takes one real minute) drives schedules, events, the market,
every screen and all movement. The office day runs like a real one:

- **Arrival and departure.** The building opens at 06:30 with nobody inside. Staff arrive at staggered, role-based
  times (traders and the café coordinator first, technology last; anyone in the 08:00 briefing is in before it),
  badge in at the automatic entrance, and walk to their desks. From ~17:10 they leave the same way, never before
  their last meeting ends; by ~19:15 the building is empty. Each profile shows today's badge-in/out times.
- **Stairs and elevator.** Trips of two floors always use the lift, one-floor trips usually the stairs. Riders walk
  to the lift lobby, call the car, wait, step in (max 6), press their floor, ride with the car and step out; the
  doors re-open for anyone in the doorway. If the car does not come within about a minute they take the stairs.
- **Breaks.** Coffee, staggered lunch waves, desk discussions and one or two short restroom breaks (ground-floor
  restrooms; doors closed behind them).
- **Off-site people** are hidden from the building, the minimap and the occupancy counts; you can still phone them,
  and calling them to you or to a meeting brings them in (they then stay for the day).

Coordinated events:

| Time | Event | Effect |
|---|---|---|
| 06:30-08:50 | Arrivals | Staff badge in at the entrance and take the stairs or the lift to their floor |
| 08:00 | Morning Market Briefing (Conference Room) | Traders, PMs, CEO, heads of research and risk attend; whiteboard/display show live movers |
| 09:15 | Technology stand-up | Tech team stands at the huddle table |
| 10:30 | Research Review (Meeting Room 1A) | Researchers + equities PM; notes list live draft word counts |
| 11:10 | Market-data feed incident | Tech team investigates in the server room; trader screens show "feed delayed"; ops confirmations slow; hotfix build; resolved ~11:50 |
| 12:00-14:00 | Lunch waves, coffee breaks all day | Café seats/lounge seats reserved; café orders appear on the coordinator's screen |
| 13:35 | Simulated energy sell-off | Macro book breaches its drawdown limit → risk alert → analyst acknowledges → review booked with the book's PM (Meeting Room 1B) → traders cut positions 30% → alert closes |
| 14:00 | Video interview (Interview Room) | Remote candidate (no visitor on site) |
| 15:30 | Portfolio Review (Boardroom) | PMs, CEO, risk and research heads |
| 16:30 | Compliance Training (Training Room) | Ops, coordinator, two researchers |
| 17:00 | Market close | Any de-risking still open is closed with PM and Head of Risk sign-off (exposure carried overnight) |
| 17:10-19:10 | Departures | Staff leave through the entrance; the next day starts at 06:30 with an empty building |

**Shared financial model**: trader positions roll up into three PM books (Global Equities L/S, Global Macro,
Credit Opportunities), books roll up into risk metrics (gross/net, sector exposure, VaR, intraday drawdown,
limit utilisation) and the firm view. Every screen reads this one model, so a trade on a blotter moves the
PM allocation, the risk monitor and the CEO overview at the same time; ops reconciliation tracks each fill.

**Monitors**: 69 assigned workstation monitors (plus flex desks) with stable IDs (`ws-trade-02-m3`) and
18 role-specific applications (unassigned flex desks show an "available" screen). In-world screens are small canvas textures refreshed on a distance budget;
clicking one opens a readable HTML panel generated from the *same* view model, with tabs that also switch
the physical monitor, and monitor switching within the workstation.

## Owner tools

You are the company owner. Everything here is local simulation logic; replies are composed from each person's live
simulated work (no AI service).

- **Call a meeting** (Owner → Call a meeting): pick everyone, whole departments or individuals, a room (Conference Room
  fits all 30 with standing room; Reception lobby for a standing all-hands; Boardroom, Training, meeting rooms, Interview,
  CEO Office), a topic and a duration. People leave what they are doing, walk there, and the room display, whiteboard and
  your list show who is in the room. *End meeting* sends them back.
- **Call / send people**: "Come to me" brings the selected people to where you stand; "Send there" sends them to a room
  to wait for you; "Back to desks" releases them. Instructions last 30 simulated minutes unless released.
- **Talk** (press `E` on anyone, or *Talk* in a profile): ask for a status update, P&L, risk, problems or their next
  meeting, or type anything. **Assign a task**: they work on it at their desk and report back when done.
- **Messages**: every acknowledgement and reply lands in Owner → Messages and pops up as a notification.
- **CEO courtesy**: when you walk into the Founder / CEO Office while the CEO is at the desk, the CEO stands up to
  greet you and sits down again once you take a seat (or leave).
- **Door signs**: every room door has a name plate with the room and the department working there (it follows the
  departments you set in the editor).

## The real office (default)

The app runs as a real office, not a simulation game:

- **Real time, 24/7.** The clock is your device's clock. There is no fast-forward, pause, replay or reset. Everyone
  stays in the office day and night and keeps working; meetings and breaks follow the real time of day.
- **Real data only.** Prices, history and headlines come from your Co-Invest connector (read-only). Before the first
  live prices arrive the screens show "—", not made-up numbers. Scripted events of the old demo (the 13:35 sell-off,
  the 11:10 feed incident, random trades and confirmation breaks, the fictional interview) are gone; incidents now
  come from the real feed (no update for 10 minutes opens one).
- **Chain of command.** The CEO sets the day's objectives. Each senior assigns the next task to each of their people
  (traders → their book's PM, analysts → Head of Research / Head of Risk, developers → Head of Technology, settlements →
  Operations Manager, heads and PMs → CEO). People work at their desks, report the result to their senior, the senior
  reviews it (accept or send back), and problems go to a meeting where a decision is taken. Work never runs out.
- **Real work by role** (all on real data):
  - Traders test strategy set-ups on Co-Invest candles (1h/4h/1d, up to 200 bars): 5 families × parameter grids,
    walk-forward (choose on 65 %, judge on the unseen 35 %), with fees and slippage.
  - Researchers write regime reports (trend, RSI, ATR from 4h candles), news briefs and peer reviews of passed strategies.
  - Risk stress-tests every passed strategy with doubled costs and writes firm risk reports (exposure, VaR, daily loss).
  - PMs allocate paper capital (volatility-targeted; ≤ 25 % per strategy, ≤ 35 % per market, 20 % cash) and retire losers.
  - Technology refreshes data, checks feed health (opens/closes incidents) and self-tests the backtest engine.
  - Operations reconciles strategy books with the ledger and reports P&L; the front office keeps bookings and minutes.
- **Problem-solving meetings**: five failed tests in a row → a research-direction meeting picks the family/interval that
  has done best firm-wide; a 2 % daily loss → kill switch (flatten, pause) and a risk committee; stale data → incident
  meeting.
- **Monitors show the work**: each person's screen shows their current task, who assigned it, progress and result,
  plus the real data behind it (candle charts, test tables, the strategy book, feed health, real jobs).
- **Owner → Work board / Strategies** show objectives and their progress, the reporting lines with everyone's task,
  reports to seniors, meetings and decisions, every strategy test and the live strategies' paper P&L.
- **Memory**: work, strategies, test results and the paper ledger are saved in the browser and restored on reload.
  Market data is never stored: prices, candles and headlines are fetched live from Co-Invest on every visit.

**What "real" cannot mean here (honest limits):**
- The office works only while the page is open in a browser (no server: the repository's rules forbid paid services).
  For 24/7 operation keep it open on an always-on computer. When reopened, unfinished tasks resume; nothing ran while
  it was closed and no trades were made.
- Paper trading only. The page has no order tool for Co-Invest. Co-Invest's own paper account needs your approval for
  every order (the connector's rule), so it cannot be traded automatically; the office keeps its own paper ledger at
  live prices. No credentials are needed for anything the office does.
- History is limited to 200 candles per interval from the connector, so tests are short; funding costs of perpetuals
  are not modelled. The process maximises the odds and caps losses; it cannot guarantee profit.
- Claude writes replies when you talk to someone or ask the CEO for an analysis (the runtime only allows Claude calls
  on a viewer's action); the office's own decisions follow the rules above, applied to real numbers.

`?office=test-sim` is the automated tests' harness (an accelerated, seeded demo day); it is not linked in the app.

## World markets screens

A large *World markets* screen hangs in the reception lobby, café, trading floor, research area, risk, Conference
Room, Boardroom, CEO office, portfolio management and staff lounge. It shows:

- **Exchange clocks in real time** (your device clock and each city's time zone, daylight saving included): Sydney,
  Tokyo, Shanghai, Hong Kong, Mumbai, Dubai, Frankfurt, London and New York, each marked OPEN / LUNCH / CLOSED with
  the time to the next open or close. Regular weekday sessions; exchange holidays are not shown.
- **Key markets**: index, gold, oil and crypto prices (live from Co-Invest when connected, simulated otherwise).
- **Headlines**: live headlines from Co-Invest when connected; otherwise the office's own market news.

## Live prices, Claude replies and office workflows

These features switch on only when the page is opened in claude.ai (the published artifact). Anywhere else the office
runs fully offline on the simulated market with scripted replies.

- **Live prices (read-only).** With your **Co-Invest** connector the page reads `analyze_markets_batch` (prices and
  24 h change every 30 s), `get_news` (headlines every 5 min) and, when you start training, `get_technical_indicators`.
  The 12 instrument slots become real markets (NVDA, MU, AAPL, TSLA, SNDK, SK hynix, S&P 500, gold, NASDAQ 100, WTI,
  BTC, ETH) and the credit book becomes *Digital Assets*; the day restarts with positions sized at live prices. No order
  tool is declared, so the page **cannot** place trades on Co-Invest; all trading is paper inside the office. The top-bar
  chip shows LIVE / stale / off and how to fix a missing or denied connector.
- **Claude as the employees' brain.** Talk replies are written by Claude from each person's live briefing (activity,
  positions, orders, meetings, training, CEO report), in the language you write in. Claude can act through page tools:
  take on a task, go to a room, come to you, go back to work; the CEO can also call meetings and start training.
  *CEO report → Ask the CEO for an analysis* writes a management briefing with recommendations. Uses your Claude plan;
  claude.ai asks once. Falls back to scripted replies if unavailable.
- **Live strategy lab.** With live data the lab reads each symbol's regime (price vs 50/200-hour averages, RSI) and
  starts a **forward test** at 10 % size on live prices (paper). After 8 round trips a profitable strategy is promoted to
  full size and a losing one is suspended and reported. Nothing guarantees a profit; losing strategies are cut, not hidden.
- **Workflow.** Researchers publish notes → the PM of the book approves or rejects the idea → the covering trader
  executes it (paper) → every order passes a risk pre-trade check → Operations confirms trades and fixes breaks. Idea
  results are tracked (Owner → Workflow).
- **Mistakes and coaching.** Traders occasionally key a 10× order size (less often with more skill): the risk
  pre-trade check blocks most; the rest are spotted and unwound, with the cost booked. Builds fail, people arrive late
  (and miss the start of meetings). Work mistakes lead to a 15-minute one-to-one with the manager (trader → PM,
  developer → tech lead, others → CEO) that raises the person's skill. The CEO report summarises ideas, mistakes,
  costs and coaching.

## Training and paper trading

Owner → **Training** starts the *ASTRA Academy*. Everything is paper trading: simulated money on fictional
instruments, no broker, no real orders.

- **Traders: strategy lab.** Each trader backtests 48 intraday strategies (momentum and mean reversion; look-back
  10/20/40 min, entry 1-2.5σ, stop 0.3/0.6%) on 28 practice sessions of the symbols they cover, picks the best by
  risk-adjusted return (Sharpe, after costs), then checks it on 8 sessions it has never seen. Only strategies that
  also hold up on the unseen sessions trade live (a 25 % overlay on core positions, flat before the close). Rejected
  strategies are reported honestly and those traders keep turnover low. The practice tape comes from the same market
  model as the office (the fictional instruments have mild intraday trending or mean-reverting behaviour), so some
  strategies pass and some do not; nothing guarantees a profit.
- **Everyone else: Training Room sessions.** Each department gets 40-minute sessions (12 seats) for the next module of
  its curriculum (e.g. Risk: VaR and limits, stress testing, breach escalation). Traders' classroom modules are after
  the market close. An assessment (pass mark 70 %) raises skill with diminishing returns; failed or missed modules are
  rebooked. Skill changes simulated output: research writing speed, ops break resolution, café service, how fast the
  technology team fixes the feed incident.
- Results (skills, modules, strategies) are saved in the browser and survive reloads and resets; changing someone's
  role in the editor clears their record.

**CEO reporting.** Owner → **CEO report** (or ask the CEO for "the report") gives the paper account (capital, NAV,
today's and recent P&L, gross/net, VaR), each book, best and weakest traders, live strategies, risk alerts,
operations, technology, research, attendance and training progress, all from the live simulated state. The CEO also
sends an end-of-day report to your inbox at 17:20.

## Project layout

```
src/world/    building, furnishing plan, walkable surfaces, colliders, nav grid (A*), doors/lift state
src/sim/      clock, market, finance/risk, tech, events, schedules, training (backtests, curricula), employee state machine, apps registry
src/apps/     AppView builders, canvas renderer (in-world screens), HTML renderer (panels)
src/scene/    three.js / React Three Fiber scene: floors, props, people, screens, doors, lift, camera, lighting
src/ui/       HUD, minimap, panels, directory, settings & office editor, touch controls
src/config/   defaults (30 fictional employees), validation, localStorage persistence
tests/        vitest suites (layout, movement, simulation day, configuration)
e2e/          playwright-core browser acceptance script and screenshots
```

## Documentation

- [CONFIGURATION.md](CONFIGURATION.md) — editor, JSON format, role types, workstation IDs
- [VERIFICATION.md](VERIFICATION.md) — test results, tested environment, measured numbers
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — feature checklist and known limitations
- [ATTRIBUTION.md](ATTRIBUTION.md) — assets (all procedural) and dependency licences; live data comes from the viewer's own Co-Invest connector at run time (nothing bundled)
