// High preset only: restrained post-processing (ambient occlusion, SMAA, light vignette).
// Loaded lazily so Low/Medium never download it.
import { EffectComposer, N8AO, SMAA, Vignette } from '@react-three/postprocessing';

export default function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={0.6} intensity={1.6} distanceFalloff={0.6} halfRes />
      <SMAA />
      <Vignette eskil={false} offset={0.25} darkness={0.35} />
    </EffectComposer>
  );
}
