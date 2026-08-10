'use client';
import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { StarField } from './StarField';
import { StarLabels } from './StarLabels';
import { DustParticles } from './DustParticles';
import { ConstellationLines } from './ConstellationLines';
import { PlanetSystem } from './PlanetSystem';
import { TrajectoryPath } from './TrajectoryPath';
import { CameraRig } from './CameraRig';
import { PostProcessing } from './PostProcessing';

function GalaxyGroup({ companies }: { companies: Company[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const r3f = useThree();

  // Debug handle: expose the R3F root store + THREE for scene inspection
  useEffect(() => {
    const handle = window as unknown as Record<string, unknown>;
    handle.__galaxy = {
      ...((handle.__galaxy as Record<string, unknown>) ?? {}),
      r3f,
      THREE,
    };
  }, [r3f]);
  const hoverStar = useGalaxyStore((s) => s.hoverStar);
  const selectStar = useGalaxyStore((s) => s.selectStar);
  const selectedStar = useGalaxyStore((s) => s.selectedStar);
  const showTrajectory = useGalaxyStore((s) => s.showTrajectory);

  // The galaxy rotates very slowly (imperceptible drift, adds life)
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.008;
  });

  return (
    <>
      <group ref={groupRef}>
        <StarField companies={companies} onStarHover={hoverStar} onStarSelect={selectStar} />
        <ConstellationLines companies={companies} />
        <StarLabels companies={companies} groupRef={groupRef} />
        {selectedStar && <PlanetSystem company={selectedStar} />}
        {selectedStar?.trajectory && showTrajectory && <TrajectoryPath company={selectedStar} />}
      </group>
      <DustParticles />
      <CameraRig groupRef={groupRef} />
    </>
  );
}

export default function GalaxyScene({ companies }: { companies: Company[] }) {
  return (
    <Canvas
      style={{ position: 'absolute', inset: 0 }}
      camera={{ position: [0, 0, 800], fov: 60, near: 0.1, far: 5000 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.setClearColor('#030308', 1);
      }}
    >
      <PostProcessing />
      <GalaxyGroup companies={companies} />
    </Canvas>
  );
}
