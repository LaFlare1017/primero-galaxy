'use client';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Company } from '@/types';
import { COLORS, maturityColor } from '@/lib/constants';

const UP = new THREE.Vector3(0, 1, 0);
const DRAW_DURATION = 2; // seconds
const TRAVEL_DURATION = 2; // seconds

/**
 * Transformation trajectory: a violet Catmull-Rom spline from the company's
 * current position toward its target (future) position at the mature core.
 * The line draws on, then a bright orb travels along it and loops; a ghosted
 * target star marks the destination.
 */
export function TrajectoryPath({ company }: { company: Company }) {
  const trajectory = company.trajectory!;
  const drawProgress = useRef(0);
  const orbProgress = useRef(0);
  const orbRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const startDraw = useRef(0); // clock time when drawing began (delay per star)

  const { curve, geometry, vertexCount, milestonePoints } = useMemo(() => {
    const start = new THREE.Vector3(
      company.position.x,
      company.position.y,
      company.position.z
    );
    const end = new THREE.Vector3(
      trajectory.targetPosition.x,
      trajectory.targetPosition.y,
      trajectory.targetPosition.z
    );

    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const perp = new THREE.Vector3().crossVectors(dir, UP);
    if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
    perp.normalize();
    const control = mid.clone().addScaledVector(perp, 14).addScaledVector(UP, 10);

    const curve = new THREE.CatmullRomCurve3([start, control, end]);
    const points = curve.getPoints(80);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    geo.setDrawRange(0, 0);

    const milestonePoints = [0.25, 0.5, 0.75].map((t) => curve.getPointAt(t));

    return { curve, geometry: geo, vertexCount: points.length, milestonePoints };
  }, [company, trajectory]);

  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: COLORS.trajectory,
        transparent: true,
        opacity: 0.6,
        toneMapped: false,
        depthWrite: false,
      }),
    []
  );

  // Built imperatively: R3F's JSX `line` intrinsic collides with SVG's in TS
  const line = useMemo(() => new THREE.Line(geometry, lineMaterial), [geometry, lineMaterial]);

  const ghostColor = useMemo(
    () => new THREE.Color(maturityColor(trajectory.targetMaturity)).multiplyScalar(1.4),
    [trajectory.targetMaturity]
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (startDraw.current === 0) startDraw.current = t;
    const elapsed = t - startDraw.current;

    // 1. Draw on
    if (drawProgress.current < 1) {
      drawProgress.current = Math.min(1, drawProgress.current + delta / DRAW_DURATION);
      const eased = easeInOutCubic(drawProgress.current);
      geometry.setDrawRange(0, Math.floor(vertexCount * eased));
      orbProgress.current = 0;
    }
    // 2. Travel (starts once fully drawn), then loop
    else {
      orbProgress.current = (orbProgress.current + delta / TRAVEL_DURATION) % 1;
    }

    // Orb
    if (orbRef.current) {
      const pos = curve.getPointAt(orbProgress.current);
      orbRef.current.position.copy(pos);
      const pulse = 0.85 + 0.3 * Math.sin(t * 4);
      orbRef.current.scale.setScalar(pulse);
    }

    // Ghost target: subtle breathe
    if (ghostRef.current) {
      const pulse = 1 + 0.06 * Math.sin(t * 1.6);
      ghostRef.current.scale.setScalar(pulse * ghostScale);
    }
  });

  const ghostScale = 4 + (trajectory.targetMaturity / 100) * 4;

  return (
    <group>
      <primitive object={line} />

      {/* Traveling orb */}
      <mesh ref={orbRef} scale={0}>
        <sphereGeometry args={[1.1, 16, 16]} />
        <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
      </mesh>

      {/* Milestone markers */}
      {milestonePoints.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.45, 10, 10]} />
          <meshBasicMaterial color={COLORS.trajectory} transparent opacity={0.8} toneMapped={false} />
        </mesh>
      ))}

      {/* Ghosted target star */}
      <mesh
        ref={ghostRef}
        position={[trajectory.targetPosition.x, trajectory.targetPosition.y, trajectory.targetPosition.z]}
        scale={ghostScale}
      >
        <icosahedronGeometry args={[1, 2]} />
        <meshBasicMaterial color={ghostColor} transparent opacity={0.35} toneMapped={false} />
      </mesh>
    </group>
  );
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
