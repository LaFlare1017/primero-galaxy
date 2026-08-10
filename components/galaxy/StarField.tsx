'use client';
import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { smoothstep } from '@/lib/utils';
import { maturityColor } from '@/lib/constants';

interface StarFieldProps {
  companies: Company[];
  onStarHover: (company: Company | null) => void;
  onStarSelect: (company: Company) => void;
}

/**
 * All 500 data stars in a single InstancedMesh draw call.
 * Per-instance: position, maturity color (brightness-tuned for bloom),
 * scale (maturity + hover + featured pulse), staggered appear animation,
 * and a dim "focus" effect while in planet view.
 */
export function StarField({ companies, onStarHover, onStarSelect }: StarFieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
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
      phases[i] = (i % 11) * 0.57;

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
    let written = 0;

    for (let i = 0; i < companies.length; i++) {
      const appear = smoothstep(appearDelays[i], appearDelays[i] + 1.1, t);
      if (appear <= 0.001) continue;
      written++;

      let scale = baseScales[i] * appear;

      if (featured[i]) {
        // Steady 4s breathe on the featured stars
        scale *= 1 + 0.07 * Math.sin(t * 1.57 + phases[i]);
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

      // Color: base * dim, with featured brightness pulsing to drive bloom
      let b = dim;
      if (featured[i]) b *= 0.85 + 0.15 * Math.sin(t * 1.57 + phases[i]);
      color.setRGB(baseColors[i * 3] * b, baseColors[i * 3 + 1] * b, baseColors[i * 3 + 2] * b);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // The raycast's coarse bounding-sphere guard lazily computes the mesh's
    // boundingSphere the first time it fires — and if that happens while the
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
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, companies.length]}
      frustumCulled={false}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onDoubleClick={handleDoubleClick}
    />
  );
}
