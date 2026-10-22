# Configuration guide

ASTRA HQ keeps two things in the browser's `localStorage`:

| Key | Contents |
|---|---|
| `astra-hq:config:v1` | Office configuration: company display name, seed and the employee roster |
| `astra-hq:settings:v1` | Viewer settings: graphics preset, lighting mode, sound, labels, minimap, FPS display, mouse sensitivity, invert-Y |

Nothing is sent anywhere. Clearing site data (or **Settings → Office editor → Restore defaults**) returns to the built-in defaults.

## Editing in the app

Open **⚙ Settings → Office editor**:

- **Company display name** — default `ASTRA`. Used on the exterior canopy, roof sign, monument, reception logo wall, boardroom and first-floor logos, the top bar and wall displays.
- **Employees** — rename, change the role title, role type (behaviour), department and trading book.
- **Desk** — pick any workstation. If it belongs to someone else the two employees swap desks; flex desks (`ws-flex-01`, `ws-flex-02`) are free by default.
- **Save & apply** validates, stores the configuration locally and restarts the simulated day so schedules, events and monitor applications follow the new roles.
- **Export JSON** downloads the current configuration. **Import JSON** validates a file first; if anything is wrong the import is rejected, the errors are listed, and the previous configuration stays active.

## File format

```jsonc
{
  "schemaVersion": 1,            // must be 1
  "companyName": "ASTRA",        // 1-40 characters
  "seed": 20261022,              // optional non-negative integer; same seed = same simulated day
  "employees": [                 // 1-32 entries (one per workstation at most)
    {
      "id": "e01",               // unique, lowercase letters/digits/dashes, 2-32 chars
      "name": "Maya Chen",       // 1-60 characters (fictional placeholder)
      "roleType": "receptionist",
      "title": "Receptionist",   // free text shown in profiles (1-60)
      "department": "Front Office",
      "workstationId": "ws-reception",
      "bookId": "eq",            // optional; traders and portfolio managers: "eq" | "macro" | "credit"
      "appearance": {
        "skin": "#e0b593", "hair": "#1b1512", "hairStyle": "bun",
        "top": "#2f3b52", "topStyle": "blazer", "bottom": "#24252b", "shoes": "#1d1b1a",
        "height": 0.96,          // 0.85-1.15 (1 = 1.75 m)
        "build": 0.95,           // 0.85-1.2
        "glasses": false
      }
    }
  ]
}
```

### Role types

| `roleType` | Monitor applications | Typical routine |
|---|---|---|
| `receptionist` | Visitors & directory, room bookings & occupancy | Front desk, short lunch |
| `trader` | Charts, watchlist & orders, positions & blotter | Trades while at the desk, morning briefing, de-risks after a risk review |
| `researcher` | Report writer, valuation model | Drafts notes, research review |
| `risk` | Exposure & drawdown, limits & alerts | Acknowledges alerts, attends risk reviews |
| `pm` | Allocation & positions, performance & summary | Briefing, portfolio review, risk review for their book |
| `tech` | Code editor & builds, terminal & service metrics | Stand-up, incident investigation in the server room |
| `ops` | Reconciliation & breaks, task queue & schedule | Resolves trade breaks, compliance training |
| `ceo` | Company overview, firm portfolio & risk | Briefing, portfolio review |
| `coordinator` | Café orders & room set-up | Works the café counter, prepares orders |

### Workstations

| IDs | Room | Monitors |
|---|---|---|
| `ws-reception` | Reception & Lobby (G) | 2 |
| `ws-cafe` | Café counter (G) | 1 |
| `ws-trade-01` … `ws-trade-10` | Trading Floor (1) | 3 each |
| `ws-res-01` … `ws-res-05` | Research Area (1) | 2 each |
| `ws-flex-01`, `ws-flex-02` | Research Area (1), flex | 1 each |
| `ws-risk-01` … `ws-risk-03` | Risk Management (1) | 2 each |
| `ws-ops-01`, `ws-ops-02` | Operations (2) | 2 each |
| `ws-tech-01` … `ws-tech-04` | Technology (2) | 2 each |
| `ws-ceo` | Founder / CEO Office (2) | 2 |
| `ws-pm-01` … `ws-pm-03` | Portfolio Management (2) | 2 each |

Monitor IDs are `<workstationId>-m1`, `-m2`, `-m3`. If a role has fewer applications than a desk has monitors, applications repeat; an unassigned desk shows an "available" screen.

Allowed `hairStyle`: `short`, `long`, `bun`, `buzz`, `bald`, `curly`, `bob`. Allowed `topStyle`: `shirt`, `blazer`, `sweater`, `blouse`.

## What is not configurable

The building layout, rooms, furniture and event calendar are defined in code (`src/world/building.ts`, `src/world/furniture.ts`, `src/sim/events.ts`). This is deliberate: the app is not an architectural editor. Event attendees are chosen by role type, so editing roles changes who attends what.
