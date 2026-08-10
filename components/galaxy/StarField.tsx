'use client';
import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { smoothstep } from '@/lib/utils';
import { breathFrequency, breathPhase, maturityColor, starBreath } from '@/lib/constants';

interface StarFieldProps {
  companies: Company[];
  onStarHover: (company: Company | null) => void;
  onStarSelect: (company: Company) => void;
}

// Glow halo: every star gets a camera-facing, additive ring that breathes
// with it; the reference look is a hollow, glowing bubble (bright rim, dark
// interior). The ring texture supplies the rim; additive blending + bloom
// supply the radiance; the instance color keeps the red/yellow/green
// maturity story.
const HALO_RATIO = 3.4; // halo diameter relative to the star core
const HALO_BRIGHTNESS = 1.35; // pushes the ring over the bloom threshold

/** 256px soft ring-glow texture: hollow center, bright rim, fading edge. */
function makeRingGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const center = (size - 1) / 2;
  const radius = center;
  const peak = 0.6; // ring peak position (0 center → 1 edge)
  const width = 0.28; // ring half-width (narrower = more rim, less blob)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center) / radius;
      let a = 1 - Math.abs(d - peak) / width;
      a = a > 0 ? Math.pow(a, 1.6) : 0;
      const i4 = (y * size + x) * 4;
      data[i4] = 255;
      data[i4 + 1] = 255;
      data[i4 + 2] = 255;
      data[i4 + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * All data stars in a single InstancedMesh draw call.
 * Per-instance: position, maturity color (brightness-tuned for bloom),
 * scale (maturity + hover + featured pulse), staggered appear animation,
 * and a dim "focus" effect while in planet view.
 */
export function StarField({ companies, onStarHover, onStarSelect }: StarFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);
  const hoveredIndex = useRef(-1);
  const dimFactor = useRef(0);
  const sphereFor = useRef<THREE.InstancedMesh | null>(null);
  const sphereComputed = useRef(false);

  const mode = useGalaxyStore((s) => s.mode);
  const selectedId = useGalaxyStore((s) => s.selectedStar?.id);

  const { baseScales, appearDelays, baseColors, featured, phases } = useMemo(() => {
    const baseScales = new Float32Array(companies.length);
    const appearDelays = new Float32Array(companies.length);
    const baseColors = new Float32Array(companies.length * 3);
    const featured = new Uint8Array(companies.length);
    const phases = new Float32Array(companies.length);

    const color = new THREE.Color();
    companies.forEach((company, i) => {
      const m = company.maturity.overall;
      baseScales[i] = 1 + (m / 100) * 1.1; // low ~1.0, high ~2.1
      featured[i] = company.isFeatured ? 1 : 0;
      phases[i] = breathPhase(i);

      // Brightness tuned so only bright/featured stars cross the bloom threshold
      let brightness = 0.8 + (m / 100) * 0.6; // ~0.85 -> ~1.4
      if (company.isFeatured) brightness *= 1.7;
      color.set(maturityColor(m)).multiplyScalar(brightness);
      baseColors[i * 3] = color.r;
      baseColors[i * 3 + 1] = color.g;
      baseColors[i * 3 + 2] = color.b;

      // Staggered appear: stars nearer the initial camera position first
      const distFactor = smoothstep(-380, 380, company.position.z); // 0 far, 1 near
      appearDelays[i] = (1 - distFactor) * 3.8 + (i % 7) * 0.05;
    });

    return { baseScales, appearDelays, baseColors, featured, phases };
  }, [companies]);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 2), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false, // needed for bloom to pick stars up
      }),
    []
  );

  const haloGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const haloTexture = useMemo(() => makeRingGlowTexture(), []);
  const haloMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: haloTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [haloTexture]
  );

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const t = state.clock.elapsedTime;

    // Focus dimming: other stars fade to ~20% in planet view
    const targetDim = mode === 'planet' ? 1 : 0;
    dimFactor.current += (targetDim - dimFactor.current) * Math.min(1, delta * 2.5);
    const dim = 1 - dimFactor.current * 0.8;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const quat = new THREE.Quaternion();
    const camQuat = state.camera.quaternion; // shared billboard orientation for every halo
    let written = 0;

    for (let i = 0; i < companies.length; i++) {
      const appear = smoothstep(appearDelays[i], appearDelays[i] + 1.1, t);
      if (appear <= 0.001) continue;
      written++;

      let scale = baseScales[i] * appear;

      // Every star breathes, phase- and frequency-offset so the whole field
      // undulates organically instead of pulsing in lockstep.
      scale *= 1 + starBreath.core.amplitude * Math.sin(t * breathFrequency(i, starBreath.core) + phases[i]);

      if (featured[i]) {
        // Featured stars breathe a little stronger (extra bloom drive)
        scale *= 1 + 0.05 * Math.sin(t * 1.57 + phases[i] * 1.3);
      } else {
        // Subtle irregular flicker on low-maturity stars (simulated instability)
        const m = companies[i].maturity.overall;
        if (m <= 40) scale *= 1 + 0.05 * Math.sin(t * (2.2 + (i % 5) * 0.35) + phases[i] * 3);
      }

      if (i === hoveredIndex.current) scale *= 1.3;
      if (selectedId === companies[i].id && mode !== 'planet') scale *= 1.25;

      const p = companies[i].position;
      dummy.position.set(p.x, p.y, p.z);
      dummy.quaternion.copy(quat);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color: base * dim, with a gentle universal shimmer and a stronger
      // featured pulse to drive bloom
      let b = dim * (0.92 + 0.08 * Math.sin(t * 1.3 + phases[i] * 1.7));
      if (featured[i]) b *= 0.85 + 0.15 * Math.sin(t * 1.57 + phases[i]);
      color.setRGB(baseColors[i * 3] * b, baseColors[i * 3 + 1] * b, baseColors[i * 3 + 2] * b);
      mesh.setColorAt(i, color);

      // Glow halo: breathes with the core (slightly out of phase), billboarded
      // toward the camera, maturity-colored so red/yellow/green stays intact.
      const halo = haloRef.current;
      if (halo) {
        const haloScale =
          scale *
          HALO_RATIO *
          (1 +
            starBreath.halo.amplitude *
              Math.sin(
                t * breathFrequency(i, starBreath.halo) + phases[i] + starBreath.halo.phaseBias
              ));
        dummy.position.set(p.x, p.y, p.z);
        dummy.quaternion.copy(camQuat);
        dummy.scale.setScalar(haloScale);
        dummy.updateMatrix();
        halo.setMatrixAt(i, dummy.matrix);

        let hb =
          dim *
          HALO_BRIGHTNESS *
          (starBreath.halo.brightnessBase +
            starBreath.halo.brightnessAmplitude *
              Math.sin(t * starBreath.halo.baseFrequency + phases[i] + starBreath.halo.phaseBias));
        if (featured[i]) hb *= 1.2;
        color.set(maturityColor(companies[i].maturity.overall)).multiplyScalar(hb);
        halo.setColorAt(i, color);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const halo = haloRef.current;
    if (halo) {
      halo.instanceMatrix.needsUpdate = true;
      if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    }

    // The raycast's coarse bounding-sphere guard lazily computes the mesh's
    // boundingSphere the first time it fires, and if that happens while the
    // appear animation still has every instance matrix at identity, it caches
    // a unit sphere at the origin. Every ray that doesn't pass within ~1 unit
    // of the galaxy center is then rejected early: hover is dead almost
    // everywhere. Compute it ourselves once all instances have real matrices.
    // (Adding a user star recreates the InstancedMesh via a changed `count`
    // arg, so reset the flag whenever the mesh identity changes.)
    if (sphereFor.current !== mesh) {
      sphereFor.current = mesh;
      sphereComputed.current = false;
    }
    if (!sphereComputed.current && written === companies.length) {
      mesh.computeBoundingSphere();
      sphereComputed.current = true;
    }
  });

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id !== undefined && id !== hoveredIndex.current) {
      hoveredIndex.current = id;
      onStarHover(companies[id]);
      document.body.style.cursor = 'pointer';
    }
  };

  const handlePointerOut = () => {
    if (hoveredIndex.current !== -1) {
      hoveredIndex.current = -1;
      onStarHover(null);
      document.body.style.cursor = 'default';
    }
  };

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id !== undefined) onStarSelect(companies[id]);
  };

  return (
    <>
      {/* Halos render first so the solid cores sit on top of their rings. */}
      <instancedMesh
        ref={haloRef}
        args={[haloGeometry, haloMaterial, companies.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, companies.length]}
        frustumCulled={false}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onDoubleClick={handleDoubleClick}
      />
    </>
  );
}
