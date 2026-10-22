// Daylight/night lighting: sky dome, hemisphere fill, sun with optional shadows, and a locally generated
// reflection environment (no downloaded HDR files).
import { Environment, Lightformer } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { setLightMood } from './materials';

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_FRAG = `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4)); gl_FragColor = vec4(c,1.0); }`;

export function Lighting({ night, shadows, shadowMapSize, envResolution }: { night: number; shadows: boolean; shadowMapSize: number; envResolution: number }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
  }), []);
  useEffect(() => () => skyMat.dispose(), [skyMat]);

  useEffect(() => {
    const day = 1 - night;
    const lerpC = (a: string, b: string) => new THREE.Color(a).lerp(new THREE.Color(b), night);
    skyMat.uniforms.top.value.copy(lerpC('#6b9fd4', '#0b1224'));
    skyMat.uniforms.horizon.value.copy(lerpC('#dfe8ef', '#2a3350'));
    skyMat.uniforms.bottom.value.copy(lerpC('#9aa3a8', '#11131a'));
    if (sun.current) {
      sun.current.intensity = 2.2 * day + 0.05;
      sun.current.color.copy(lerpC('#fff4e2', '#8aa0ff'));
    }
    if (hemi.current) hemi.current.intensity = 0.55 * day + 0.25;
    if (amb.current) amb.current.intensity = 0.22 + night * 0.45;
    if (amb.current) amb.current.color.copy(lerpC('#ffffff', '#ffe8cc'));
    setLightMood(night);
  }, [night, skyMat]);

  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    s.castShadow = shadows;
    if (shadows) {
      s.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      const cam = s.shadow.camera;
      cam.left = -26; cam.right = 26; cam.top = 26; cam.bottom = -26; cam.near = 1; cam.far = 140;
      cam.updateProjectionMatrix();
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.03;
      s.shadow.map?.dispose();
      s.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }, [shadows, shadowMapSize]);

  return (
    <>
      <mesh material={skyMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[900, 32, 16]} />
      </mesh>
      <hemisphereLight ref={hemi} args={['#e9f1ff', '#8a7d6c', 1]} />
      <ambientLight ref={amb} intensity={0.4} />
      <directionalLight ref={sun} position={[-30, 55, 60]} intensity={2.4}>
        <object3D attach="target" position={[17, 0, 10]} />
      </directionalLight>
      <Environment resolution={envResolution} frames={1} environmentIntensity={0.45 + (1 - night) * 0.25}>
        <color attach="background" args={['#bfc6cc']} />
        <Lightformer form="rect" intensity={2.2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={1.2} position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} color="#fff2df" />
        <Lightformer form="rect" intensity={1.2} position={[8, 2, 0]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} color="#e3efff" />
        <Lightformer form="ring" intensity={0.8} position={[0, 1, -8]} scale={4} color="#d0ab62" />
      </Environment>
    </>
  );
}

/** 0 = full day, 1 = full night, from the simulated clock (auto) or a fixed setting. */
export function nightFactor(mode: 'auto' | 'day' | 'night', minute: number): number {
  if (mode === 'day') return 0;
  if (mode === 'night') return 1;
  const h = minute / 60;
  if (h < 6.5) return 1;
  if (h < 7.5) return 1 - (h - 6.5);
  if (h < 18) return 0;
  if (h < 19.25) return (h - 18) / 1.25;
  return 1;
}
