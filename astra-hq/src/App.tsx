import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { connectLive, disconnectLive } from './live/feed';
import * as THREE from 'three';
import { SceneRoot } from './scene/SceneRoot';
import { PRESETS } from './scene/quality';
import { CenterOverlays, IntroOverlay, LeftDock, RightDock, TopBar, useShortcuts } from './ui/HUD';
import { PanelHost } from './ui/Panels';
import { TouchControls } from './ui/TouchControls';
import { ErrorBoundary, webglSupport } from './ui/ErrorBoundary';
import { useUI } from './store/ui';
import { getSim, startupWarning } from './store/simInstance';
import { player, requestTeleport } from './store/player';
import * as actions from './ui/actions';
import { setSoundEnabled } from './audio/sound';
import { activateHit } from './scene/Interaction';
import { vis } from './scene/visibility';

function Fallback({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="error-screen">
      <div className="overlay-card">
        <span className="chip sim-chip">OFFICE SIMULATION</span>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        <p>{detail}</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}

export function App() {
  const graphics = useUI((s) => s.settings.graphics);
  const [labelLayer, setLabelLayer] = useState<HTMLDivElement | null>(null);
  const [gl] = useState(webglSupport);
  const [contextLost, setContextLost] = useState(false);
  useShortcuts();
  useEffect(() => {
    if (startupWarning) useUI.getState().showToast(startupWarning);
    // debug/test hooks (no secrets; read-only views of local state)
    const w = window as unknown as { __astra?: Record<string, unknown> };
    w.__astra = { ...(w.__astra ?? {}), sim: getSim, ui: useUI, player, teleport: requestTeleport, actions, vis };
    // sound setting persists, but audio may only start after a user gesture
    const once = () => { if (useUI.getState().settings.sound) setSoundEnabled(true); };
    window.addEventListener('pointerdown', once, { once: true });
    // live market prices from the viewer's Co-Invest connector (read-only), when the page runs in claude.ai
    void connectLive(getSim, (s) => useUI.getState().setLive(s));
    return () => { disconnectLive(); window.removeEventListener('pointerdown', once); };
  }, []);
  if (!gl.ok) return <Fallback title="3D view unavailable" detail={gl.reason} />;
  if (contextLost) return <Fallback title="The graphics context was lost" detail="The browser reset the GPU context (often after a driver reset or running out of video memory). Reload the page; if it keeps happening, choose the Low graphics preset in Settings." />;
  const q = PRESETS[graphics];
  return (
    <div className="app">
      <ErrorBoundary fallback={(e) => <Fallback title="Something went wrong while rendering" detail={`${e.message}. Your configuration is saved; reloading usually fixes this. Try the Low preset if the problem persists.`} />}>
        <Canvas
          key={graphics}
          shadows={q.shadows ? 'soft' : false}
          dpr={[1, Math.min(q.dpr, window.devicePixelRatio || 1)]}
          gl={{ antialias: q.antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false }}
          camera={{ fov: 70, near: 0.05, far: 1500, position: [-18, 26, 58] }}
          onCreated={({ gl: r }) => {
            r.toneMapping = THREE.ACESFilmicToneMapping;
            r.toneMappingExposure = 0.92;
            r.outputColorSpace = THREE.SRGBColorSpace;
            r.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              // a preset change disposes the previous canvas on purpose; only a live canvas losing its context is an error
              window.setTimeout(() => { if (r.domElement.isConnected) setContextLost(true); }, 50);
            });
          }}
        >
          <SceneRoot labelLayer={labelLayer} />
        </Canvas>
      </ErrorBoundary>
      <div className="label-layer" ref={setLabelLayer} />
      <TopBar />
      <LeftDock />
      <RightDock />
      <CenterOverlays />
      <TouchControls onInteract={() => {
        const ev = new KeyboardEvent('keydown', { code: 'KeyE' });
        window.dispatchEvent(ev);
      }} />
      <PanelHost />
      <IntroOverlay />
    </div>
  );
}

export { activateHit };
