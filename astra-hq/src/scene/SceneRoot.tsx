// Everything inside the WebGL canvas.
import { Suspense, lazy, useMemo } from 'react';
import { useUI } from '../store/ui';
import { getSim } from '../store/simInstance';
import { CameraController } from './CameraController';
import { Doors, Elevator } from './Doors';
import { Exterior } from './Exterior';
import { Floors } from './Floors';
import { HitVolumes, Interaction } from './Interaction';
import { Lighting, nightFactor } from './Lighting';
import { People } from './People';
import { PRESETS } from './quality';
import { Labels, SimDriver, StatsProbe } from './Runtime';
import { Screens } from './Screens';

const PostFX = lazy(() => import('./PostFX'));

export function SceneRoot({ labelLayer }: { labelLayer: HTMLDivElement | null }) {
  const graphics = useUI((s) => s.settings.graphics);
  const lighting = useUI((s) => s.settings.lighting);
  const simVersion = useUI((s) => s.simVersion);
  const quality = PRESETS[graphics];
  const sim = getSim();
  // night factor changes slowly; quantise so lighting effects don't re-run every frame
  const night = Math.round(nightFactor(lighting, sim.minute) * 20) / 20;
  const companyName = sim.config.companyName;
  void simVersion;
  const shadows = quality.shadows;
  const post = useMemo(() => quality.post, [quality]);
  return (
    <>
      <SimDriver />
      <StatsProbe />
      <Lighting night={night} shadows={shadows} shadowMapSize={quality.shadowMapSize} envResolution={quality.envResolution} />
      <Suspense fallback={null}>
        <Floors shadows={shadows} />
        <Exterior companyName={companyName} night={night} cityCount={quality.cityCount} />
        <Doors />
        <Elevator />
        <People farHz={quality.peopleFarHz} />
        <Screens quality={quality} companyName={companyName} />
        <HitVolumes />
      </Suspense>
      <CameraController />
      <Interaction />
      <Labels container={labelLayer} />
      {post && (
        <Suspense fallback={null}>
          <PostFX />
        </Suspense>
      )}
    </>
  );
}
