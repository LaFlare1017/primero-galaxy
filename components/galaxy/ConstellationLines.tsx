'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { computeConstellationLinks } from '@/lib/galaxy-layout';
import { ZOOM } from '@/lib/constants';
import { smoothstep } from '@/lib/utils';

const BASE_OPACITY = 0.3;

/**
 * Faint constellation lines connecting related stars (same industry::ERP
 * group). Invisible at galaxy zoom; draws on as the camera approaches.
 * Reading zoomLevel via getState() keeps this component render-free per frame.
 */
export function ConstellationLines({ companies }: { companies: Company[] }) {
  const drawProgress = useRef(0);
  const totalVerts = useRef(0);

  const geometry = useMemo(() => {
    const links = computeConstellationLinks(companies);
    const positions = new Float32Array(links.length * 6);
    links.forEach((link, i) => {
      const a = companies[link.source].position;
      const b = companies[link.target].position;
      positions[i * 6] = a.x;
      positions[i * 6 + 1] = a.y;
      positions[i * 6 + 2] = a.z;
      positions[i * 6 + 3] = b.x;
      positions[i * 6 + 4] = b.y;
      positions[i * 6 + 5] = b.z;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    totalVerts.current = links.length * 2;
    return geo;
  }, [companies]);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#1A1A3A',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );

  useFrame((_, delta) => {
    const zoom = useGalaxyStore.getState().zoomLevel;
    const target = smoothstep(ZOOM.constellationFadeStart, ZOOM.constellationFull, zoom);
    drawProgress.current += (target - drawProgress.current) * Math.min(1, delta * 1.4);

    const p = drawProgress.current;
    geometry.setDrawRange(0, Math.floor(totalVerts.current * p));
    material.opacity = BASE_OPACITY * p;
  });

  return <lineSegments geometry={geometry} material={material} />;
}
