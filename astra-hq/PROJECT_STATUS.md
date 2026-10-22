# Project status

Status legend: **Done** = implemented and covered by an automated check (unit or browser);
**Done (manual)** = implemented and inspected in screenshots but not asserted automatically;
**Partial** = works with a stated limitation; **Not done** = not implemented.

## Feature checklist

### 1. Building, navigation, collision, stairs, elevator
| Feature | Status | Evidence |
|---|---|---|
| Three floors, exterior, entrance, windows, corridors | Done | `tests/world.test.ts` room list; screenshots 01, 04, 13 |
| 3.2 m clear ceilings, 2.4 m corridors, aligned doors | Done | `building.ts` constants; door-in-wall test |
| Dog-leg stairs connecting every floor | Done | unit climb test + browser "Flight A/B" checks |
| Elevator serving all floors (call buttons, car panel) | Done | browser "Elevator carries the player" |
| First-person WASD, mouse look, pointer lock, Esc | Done | browser checks (pointer lock granted in headless Chromium) |
| Collision with walls, furniture, closed doors, people | Done | unit + browser collision checks |
| Clickable doors with collision changes | Done | browser door checks |
| Never spawn inside objects; invalid-position recovery | Done | `safeSpot`, `validPosition`, recovery in controller; spawn check |
| Orbit inspection, building overview with floor cutaway | Done | browser overview checks; "Orbit workstation" in profiles |
| Minimap with current floor and position; click room to go | Done (manual) | screenshots |
| Floor & room navigation, Return to Reception | Done | browser room-accessibility check (21 rooms) |
| Searchable directory, Go to Employee | Done | browser checks |
| Touch movement and look | Done | mobile-emulation joystick check |

### 2. Furnishing and workstations
| Feature | Status | Evidence |
|---|---|---|
| All listed rooms furnished; no inaccessible decorative rooms | Done | furniture-in-room test; every room reachable |
| 10×3, 5×2, 3 risk, 3 PM, 4 tech, 2 ops, reception 2 monitors | Done | workstation-count test |
| Monitors, keyboards, mice, phones/turrets, laptops, printers, lamps, plants, storage | Done (manual) | screenshots |

### 3. Employees
| Feature | Status | Evidence |
|---|---|---|
| Exactly 30 fictional, editable employees with required role mix | Done | roster test |
| Stable ID, name, role, department, appearance, workstation, monitor IDs | Done | profile panel; config schema |
| Current activity/location/task, daily schedule, activity history | Done | profile tabs; day-run test |
| State machine: working, reviewing, walking, meeting, café, returning, discussing (+ investigating) | Done | full-day test |
| Nav-grid routes avoiding walls/desks; closed doors avoided, opened only when needed | Done | path tests; server-room door open/close test |
| Seat reservation (no double booking) | Done | `validate()` invariant checked through a full day |
| Staggered routines, no synchronised wandering | Done | seeded schedules with collision-free placement |
| Idle, seated, typing, walking, conversation animations | Done (manual) | procedural poses; screenshots 07, 11 |

### 4-5. Shared simulation, monitors, events
| Feature | Status | Evidence |
|---|---|---|
| One seeded state; related screens agree (trader → book → risk → firm) | Done | consistency test |
| Every assigned monitor shows role-specific content | Done | unit + browser (69 monitors) |
| Expanded HTML panel = in-world screen (shared tab state) | Done | browser sync check |
| Briefing, research review, risk review after breach, tech incident, lunch/coffee, portfolio review | Done | full-day test + browser breach chain |
| Room displays show bookings and present attendees; whiteboards show notes | Done | browser conference display check |

### 6. Interactions, editor, controls
| Feature | Status | Evidence |
|---|---|---|
| Reception directory kiosk, meeting displays, whiteboards, coffee, CEO desk, market wall, lift buttons, chairs (seated view), server display | Done | browser checks for chair, coffee, CEO desk, lift; others via panel IDs |
| Editor: rename, role, department, desk reassignment (swap), company name | Done | browser persistence check |
| Save locally, export, import with validation, restore defaults | Done | unit + browser |
| Pause, 1×/2×/5×, reset, day/night, sound, labels, presets, FPS, clock, occupancy & activity counts | Done | browser clock checks; others manual |
| Audio only after user interaction; reduced-motion respected | Done (manual) | `sound.ts` creates the AudioContext on demand; reduced motion → instant camera moves, slower decorative animation |

### 7. Performance
| Feature | Status | Evidence |
|---|---|---|
| Shared materials/geometry, merged static geometry, instancing (chairs, monitors, accessories, lights, people, city, shadows) | Done | ~110-200 draw calls inside, ~530 for the full exterior view (measured) |
| Capped DPR, limited shadows, presets with real differences | Done | `quality.ts` |
| Distance-based animation and monitor refresh budget | Done | `People.tsx`, `Screens.tsx` |
| Hidden floors not rendered | Done | `visibility.ts` |
| Lazy loading | Done | post-processing chunk loaded only on High |
| Disposal of GPU resources | Done | effect cleanups in scene components |
| Measured FPS on the target laptop (Ryzen 7 4000 / RTX 3050) | **Not done** | No GPU in the build environment — see VERIFICATION.md |

## Known limitations

- **No real-GPU frame-rate measurement.** Tests ran in a container with software rendering (SwiftShader, ~1-3 fps). Only draw calls, triangle counts and CPU costs were measured. Please check the FPS overlay (Settings → Simulation → FPS) on the target laptop and pick a preset accordingly.
- **Stylised people.** Employees are procedural low-poly figures (capsules and spheres) with procedural animation, not photoreal scanned/rigged characters. No third-party character assets are bundled.
- **Employees use the stairs only.** The elevator is fully working for the visitor; employees do not ride it. Employees also do not use the restrooms (deliberately not simulated).
- **Arrival/departure.** The day starts with everyone at their desk (07:40) and loops at 19:30 to the next day with everyone back at their desks; nobody walks in through the entrance.
- **Simple crowd behaviour.** Walkers slow down behind each other and stop for the visitor, but there is no full local avoidance; two employees can briefly overlap in a corridor or on a stair flight.
- **Fixed layout and events.** The building, furniture and event calendar are code, not editable data; the editor covers people, roles, departments, desks and the company name.
- **Head-less pointer lock.** Where pointer lock is unavailable the app falls back to drag-to-look; this fallback was exercised only in headless Chromium.
- **Time scale.** Walking happens at real pace times the speed multiplier while the clock runs 20× faster, so a cross-building walk takes ~15 simulated minutes (a common simulation compromise).
- **Visual fidelity.** Lighting is a hemisphere + sun + generated environment; interior light fittings are emissive (no per-fixture real-time lights). Real-time shadows only on High.
