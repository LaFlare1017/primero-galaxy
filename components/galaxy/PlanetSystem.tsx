'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Company, MaturityDimension } from '@/types';
import { maturityColor } from '@/lib/constants';

interface MoonSpec {
  label: string;
  dimension: MaturityDimension;
  orbitRadius: number;
  speed: number;
  tilt: number;
  size: number;
  phase: number;
}

const MOONS: MoonSpec[] = [
  { label: 'Reconciliation', dimension: 'dataInfrastructure', orbitRadius: 26, speed: 0.35, tilt: 0.35, size: 1.05, phase: 0 },
  { label: 'Forecasting', dimension: 'aiDeployment', orbitRadius: 30, speed: -0.28, tilt: -0.55, size: 0.85, phase: 1.6 },
  { label: 'Document Processing', dimension: 'workflowStandardization', orbitRadius: 34, speed: 0.22, tilt: 0.95, size: 0.75, phase: 3.1 },
  { label: 'Reporting', dimension: 'governance', orbitRadius: 38, speed: -0.17, tilt: -1.05, size: 0.65, phase: 4.4 },
];

const RINGS: { dimension: MaturityDimension; radius: number }[] = [
  { dimension: 'dataInfrastructure', radius: 14 },
  { dimension: 'workflowStandardization', radius: 18.5 },
  { dimension: 'aiDeployment', radius: 23 },
];

/**
 * Planet view representation of a selected company:
 *  - large faceted core in the company's maturity color (blooms)
 *  - three orbital rings, each colored by a maturity dimension
 *  - four moons, one per AI capability, sized/colored by capability maturity
 */
export function PlanetSystem({ company }: { company: Company }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const ringGroupRef = useRef<THREE.Group>(null);
  const moonGroupRefs = useRef<(THREE.Group | null)[]>([]);

  const coreColor = useMemo(() => new THREE.Color(maturityColor(company.maturity.overall)).multiplyScalar(1.9), [company]);

  const coreScale = 6 + (company.maturity.overall / 100) * 5; // 6 - 11

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    if (coreRef.current) {
      coreRef.current.rotation.y += delta * 0.12;
      coreRef.current.rotation.x += delta * 0.05;
    }
    if (wireRef.current) {
      wireRef.current.rotation.y -= delta * 0.08;
    }
    if (ringGroupRef.current) {
      ringGroupRef.current.rotation.z += delta * 0.015;
    }
    moonGroupRefs.current.forEach((g, i) => {
      if (g) g.rotation.y += delta * MOONS[i].speed;
    });
  });

  return (
    <group>
      {/* Core */}
      <mesh ref={coreRef} scale={coreScale}>
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial color={coreColor} toneMapped={false} />
      </mesh>
      {/* Wireframe halo */}
      <mesh ref={wireRef} scale={coreScale * 1.45}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color="#1A1A3A" wireframe transparent opacity={0.5} />
      </mesh>

      {/* Rings + moons, tilted for a cinematic view */}
      <group rotation={[1.05, 0, 0.15]}>
        {RINGS.map((ring, i) => {
          const score = company.maturity[ring.dimension];
          return (
            <OrbitalRing
              key={ring.dimension}
              radius={ring.radius}
              color={maturityColor(score)}
              pulsePhase={i * 1.3}
            />
          );
        })}

        {MOONS.map((moon, i) => {
          const score = company.maturity[moon.dimension];
          const color = maturityColor(score);
          return (
            <group key={moon.label} rotation={[moon.tilt, 0, 0]}>
              <group
                rotation={[0, moon.phase, 0]}
                ref={(el) => {
                  moonGroupRefs.current[i] = el;
                }}
              >
                <mesh position={[moon.orbitRadius, 0, 0]} scale={moon.size}>
                  <sphereGeometry args={[1, 20, 20]} />
                  <meshBasicMaterial color={color} toneMapped={false} />
                </mesh>
              </group>
            </group>
          );
        })}
      </group>
    </group>
  );
}

function OrbitalRing({
  radius,
  color,
  pulsePhase,
}: {
  radius: number;
  color: string;
  pulsePhase: number;
}) {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        toneMapped: false,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [color]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.opacity = 0.45 + 0.18 * Math.sin(t * 1.2 + pulsePhase);
  });

  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} material={material}>
      <torusGeometry args={[radius, 0.09, 8, 96]} />
    </mesh>
  );
}
