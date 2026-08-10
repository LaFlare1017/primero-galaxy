'use client';
import { useMemo } from 'react';
import * as THREE from 'three';
import { mulberry32 } from '@/lib/utils';
import { SCENE } from '@/lib/constants';

const DUST_COUNT = 2000;

/**
 * Static background dust: reference points that give the camera parallax
 * depth. Deterministic positions so the void looks the same every visit.
 */
export function DustParticles() {
  const positions = useMemo(() => {
    const rng = mulberry32(99);
    const arr = new Float32Array(DUST_COUNT * 3);
    const { dustMinRadius, dustMaxRadius } = SCENE;
    for (let i = 0; i < DUST_COUNT; i++) {
      // Uniform direction on the sphere, radius in the shell band
      const u = rng() * 2 - 1;
      const theta = rng() * Math.PI * 2;
      const r = dustMinRadius + (dustMaxRadius - dustMinRadius) * Math.cbrt(rng());
      const s = Math.sqrt(1 - u * u);
      arr[i * 3] = r * s * Math.cos(theta);
      arr[i * 3 + 1] = r * u;
      arr[i * 3 + 2] = r * s * Math.sin(theta);
    }
    return arr;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#1A1A3A"
        size={1.8}
        sizeAttenuation
        transparent
        opacity={0.18}
        depthWrite={false}
      />
    </points>
  );
}
