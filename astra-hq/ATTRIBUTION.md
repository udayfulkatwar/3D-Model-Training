# Assets, licences and attribution

## Art, models, textures and audio

All visual and audio content is generated at runtime by this project's own source code:

- **Building, furniture, devices and city** — built from geometric primitives in `src/scene/buildFloor.ts`, `src/scene/props.ts`, `src/scene/Exterior.tsx`.
- **Textures** (carpet, wood, stone, tile, concrete, fabric, ceiling grid, city facades, shadows) — drawn on HTML canvas in `src/scene/textures.ts`.
- **People** — procedural, stylised low-poly figures in `src/scene/People.tsx` (no scanned or rigged third-party character models).
- **Screens and signage** — drawn on canvas from the simulation in `src/apps/canvasRender.ts`.
- **Reflections / environment lighting** — generated from light shapes at load time (no downloaded HDR files).
- **Sound** — synthesised with the Web Audio API in `src/audio/sound.ts` (no audio files).
- **Fonts** — the browser's system UI fonts; no web fonts are downloaded.

No third-party images, 3D models, HDRIs, fonts or sound files are bundled or fetched, so there is nothing further to attribute or license for art. The app makes no network requests at runtime beyond loading its own static files.

## Software dependencies (bundled in the build)

| Package | Licence |
|---|---|
| react, react-dom | MIT |
| three | MIT |
| @react-three/fiber | MIT |
| @react-three/drei (OrbitControls, Environment, Lightformer) | MIT |
| three-stdlib (via drei) | MIT |
| @react-three/postprocessing | MIT |
| postprocessing | Zlib |
| n8ao (ambient occlusion, High preset) | ISC |
| zustand | MIT |

Development-only tools (not shipped): vite, @vitejs/plugin-react, typescript, vitest, playwright-core (Apache-2.0), @types/*.

## Content disclaimer

- All 30 employees are fictional placeholders. Any resemblance to real people is coincidental; replace them with your own team in the editor.
- All instruments, prices, positions, P&L, risk figures and infrastructure metrics are **Simulated Data** from a seeded model. Instrument names are fictional. Nothing is real trading or market data.
- The building is an original design inspired by the financial industry, not a replica of any real firm's office.
