'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { EDGES, LAYER_BY_ID, NODE_BY_ID, type MapEdge, type MapNode } from './map-data';

// ── Grid layout ──────────────────────────────────────────────────────────────
const CELL = 11; // world units between grid cells
const BASE = 5.2; // building footprint
const HEIGHT_SCALE = 1.1;
const GRID_CX = 1.5; // center of the x columns
const GRID_CZ = 2.5; // center of the z rows

function gridToWorld(n: MapNode): { x: number; z: number } {
  return {
    x: (n.grid[0] - GRID_CX) * CELL,
    z: (n.grid[1] - GRID_CZ) * CELL,
  };
}

function nodeTop(n: MapNode): THREE.Vector3 {
  const { x, z } = gridToWorld(n);
  return new THREE.Vector3(x, n.height * HEIGHT_SCALE, z);
}

/** Raised quadratic arc from one building top to another. */
function arcFor(edge: MapEdge): THREE.QuadraticBezierCurve3 {
  const a = nodeTop(NODE_BY_ID[edge.from]);
  const b = nodeTop(NODE_BY_ID[edge.to]);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const lift = Math.max(6, a.distanceTo(b) * 0.35);
  mid.y += lift;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

const EDGE_COLOR: Record<MapEdge['kind'], string> = {
  payload: '#E8F6F4',
  dependency: '#7B61FF',
  control: '#F7C548',
};

// ── Camera: fixed isometric view ─────────────────────────────────────────────
function IsoCamera() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(72, 52, 72);
    // Look slightly above the origin: buildings rise up, so centering on the
    // grid's vertical midpoint keeps the back row in frame.
    camera.lookAt(0, 4, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

// ── A single building (box + top cap + edges + label) ────────────────────────
function Building({
  node,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  node: MapNode;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const { x, z } = gridToWorld(node);
  const h = node.height * HEIGHT_SCALE;
  const color = LAYER_BY_ID[node.layer].color;
  const lift = hovered || selected ? 0.6 : 0;

  const bodyColor = useMemo(() => new THREE.Color(color), [color]);
  const hoverColor = useMemo(() => new THREE.Color(color).lerp(new THREE.Color('#FFFFFF'), hovered || selected ? 0.45 : 0), [color, hovered, selected]);
  const topColor = useMemo(() => new THREE.Color(color).lerp(new THREE.Color('#FFFFFF'), 0.18), [color]);

  return (
    <group position={[x, lift, z]}>
      <mesh
        position={[0, h / 2, 0]}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(node.id);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
      >
        <boxGeometry args={[BASE, h, BASE]} />
        <meshStandardMaterial color={bodyColor} roughness={0.6} metalness={0.15} />
      </mesh>
      {/* bright top cap */}
      <mesh position={[0, h + 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BASE, BASE]} />
        <meshStandardMaterial color={topColor} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* crisp outline, brightens on hover */}
      <lineSegments position={[0, h / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(BASE, h, BASE)]} />
        <lineBasicMaterial color={hovered || selected ? '#FFFFFF' : '#000000'} transparent opacity={hovered || selected ? 0.9 : 0.28} />
      </lineSegments>
      {/* soft ground shadow */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BASE + 1.6, BASE + 1.6]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} />
      </mesh>

      <Html position={[0, h + 1.6, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="flex flex-col items-center whitespace-nowrap">
          <span
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-tight tracking-tight"
            style={{
              color: hovered || selected ? '#FFFFFF' : color,
              backgroundColor: 'rgba(3,3,8,0.72)',
              border: `1px solid ${hovered || selected ? '#FFFFFF' : `${color}55`}`,
            }}
          >
            {node.name}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── An edge arc (solid for payload, dashed for dep/control) ─────────────────
function ArcLine({ edge }: { edge: MapEdge }) {
  const line = useMemo(() => {
    const points = arcFor(edge).getPoints(48);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const color = EDGE_COLOR[edge.kind];
    const material =
      edge.kind === 'payload'
        ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
        : new THREE.LineDashedMaterial({
            color,
            transparent: true,
            opacity: 0.55,
            dashSize: 1.6,
            gapSize: 1.1,
          });
    const l = new THREE.Line(geometry, material);
    if (edge.kind !== 'payload') l.computeLineDistances();
    return l;
  }, [edge]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line]
  );

  return <primitive object={line} />;
}

// ── Animated payload dot tracing a payload edge ──────────────────────────────
function Payload({ edge, index }: { edge: MapEdge; index: number }) {
  const curve = useMemo(() => arcFor(edge), [edge]);
  const ref = useRef<THREE.Mesh>(null);
  const speed = 0.16 + (index % 3) * 0.03;
  const offset = (index % 6) / 6;

  useFrame((state) => {
    const t = (state.clock.elapsedTime * speed + offset) % 1;
    const p = curve.getPoint(t);
    if (ref.current) ref.current.position.copy(p);
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.55, 16, 16]} />
      <meshBasicMaterial color="#FFFFFF" toneMapped={false} />
    </mesh>
  );
}

// ── Scene contents ───────────────────────────────────────────────────────────
function Scene({
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const { gl } = useThree();
  useEffect(() => {
    gl.setClearColor('#060611', 1);
  }, [gl]);

  const payloadEdges = EDGES.filter((e) => e.trace);

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[50, 70, 30]} intensity={1.2} />
      <directionalLight position={[-40, 30, -50]} intensity={0.25} color="#7B61FF" />

      {/* floor grid */}
      <gridHelper args={[160, 32, '#1A1A3A', '#12122a']} position={[0, 0, 0]} />

      {NODE_BY_ID && Object.values(NODE_BY_ID).map((n) => (
        <Building
          key={n.id}
          node={n}
          hovered={hoveredId === n.id}
          selected={selectedId === n.id}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}

      {EDGES.map((e) => (
        <ArcLine key={`${e.from}-${e.to}-${e.kind}`} edge={e} />
      ))}

      {payloadEdges.map((e, i) => (
        <Payload key={`payload-${e.from}-${e.to}`} edge={e} index={i} />
      ))}
    </>
  );
}

// ── Exported canvas ──────────────────────────────────────────────────────────
export function SystemMapScene({
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Canvas
      orthographic
      camera={{ position: [72, 52, 72], zoom: 12, near: 0.1, far: 2000 }}
      dpr={[1, 2]}
      style={{ position: 'absolute', inset: 0 }}
    >
      <IsoCamera />
      <Scene hoveredId={hoveredId} selectedId={selectedId} onHover={onHover} onSelect={onSelect} />
    </Canvas>
  );
}
