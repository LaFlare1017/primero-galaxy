'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import type CameraControlsImpl from 'camera-controls';
import * as THREE from 'three';
import { useGalaxyStore } from '@/store/galaxyStore';

interface CameraRigProps {
  groupRef: React.RefObject<THREE.Group>;
}

/**
 * camera-controls integration with smooth transitions:
 *  - slow auto-orbit while idle in galaxy mode
 *  - cinematic fly-to on star selection (planet view)
 *  - reset on deselect
 *  - publishes the camera→focus distance as zoomLevel (drives LOD fades)
 */
export function CameraRig({ groupRef }: CameraRigProps) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as CameraControlsImpl | null;
  const lastInteraction = useRef(0);
  const isTransitioning = useRef(false);
  const appliedSelection = useRef<string | null>(null);
  const focusWorld = useRef(new THREE.Vector3());

  const selectedId = useGalaxyStore((s) => s.selectedStar?.id);

  // Pause auto-orbit while a camera transition is in flight so fly-to/reset
  // transitions are never cut short or fought by the idle drift.
  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      isTransitioning.current = true;
    };
    const onEnd = () => {
      isTransitioning.current = false;
    };
    // camera-controls emits `transitionend` at runtime; its public types only
    // declare `transitionstart`, so cast narrowly for the listener.
    const cc = controls as CameraControlsImpl & {
      addEventListener(type: 'transitionend', listener: () => void): void;
      removeEventListener(type: 'transitionend', listener: () => void): void;
    };
    controls.addEventListener('transitionstart', onStart);
    cc.addEventListener('transitionend', onEnd);
    return () => {
      controls.removeEventListener('transitionstart', onStart);
      cc.removeEventListener('transitionend', onEnd);
    };
  }, [controls]);

  // Debug handle: expose the camera controls alongside the store
  useEffect(() => {
    if (!controls) return;
    const handle = window as unknown as Record<string, unknown>;
    handle.__galaxy = { ...((handle.__galaxy as Record<string, unknown>) ?? {}), controls };
  }, [controls]);

  useEffect(() => {
    if (!controls) return;
    const star = useGalaxyStore.getState().selectedStar;

    if (star) {
      if (appliedSelection.current === star.id) return;
      appliedSelection.current = star.id;

      const world = new THREE.Vector3(star.position.x, star.position.y, star.position.z);
      if (groupRef.current) groupRef.current.localToWorld(world);
      const offset = new THREE.Vector3(0, 22, 58);
      const pos = world.clone().add(offset);

      controls.smoothTime = 1.5;
      controls.setLookAt(pos.x, pos.y, pos.z, world.x, world.y, world.z, true);
      const reset = setTimeout(() => {
        if (controls) controls.smoothTime = 1.2;
      }, 2100);
      return () => clearTimeout(reset);
    }

    appliedSelection.current = null;
    controls.smoothTime = 2.0;
    controls.setLookAt(0, 0, 800, 0, 0, 0, true);
    const reset = setTimeout(() => {
      if (controls) controls.smoothTime = 1.2;
    }, 2600);
    return () => clearTimeout(reset);
  }, [selectedId, controls, groupRef]);

  useFrame((_, delta) => {
    if (!controls) return;
    const state = useGalaxyStore.getState();

    // Auto-orbit when idle in galaxy mode (never fights the user's hand or
    // in-flight transitions)
    if (
      state.mode === 'galaxy' &&
      !isTransitioning.current &&
      performance.now() - lastInteraction.current > 2500
    ) {
      controls.azimuthAngle += delta * 0.012; // ~0.7 deg/s
    }

    // Zoom level = camera distance to the focus point (localToWorld accounts
    // for the slow galaxy rotation)
    const focus = focusWorld.current;
    if (state.selectedStar) {
      focus.set(
        state.selectedStar.position.x,
        state.selectedStar.position.y,
        state.selectedStar.position.z
      );
      if (groupRef.current) groupRef.current.localToWorld(focus);
    } else {
      focus.set(0, 0, 0);
    }

    const dist = camera.position.distanceTo(focus);
    if (Math.abs(dist - state.zoomLevel) > 0.5) state.setZoomLevel(dist);
  });

  return (
    <CameraControls
      makeDefault
      smoothTime={1.2}
      draggingSmoothTime={0.3}
      minDistance={14}
      maxDistance={1400}
      dollySpeed={1}
      onStart={() => {
        lastInteraction.current = performance.now();
      }}
      onEnd={() => {
        lastInteraction.current = performance.now();
      }}
    />
  );
}
