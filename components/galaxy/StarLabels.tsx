'use client';
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { maturityColor } from '@/lib/constants';
import { smoothstep } from '@/lib/utils';

// Zoom gating: labels only exist in constellation/planet range (keeps the
// galaxy view at zero extra draw calls).
const MOUNT_ZOOM = 480;
const UNMOUNT_ZOOM = 540;

// Per-star distance fades (world units from the camera). The band is narrow
// and the visibility threshold high: only a foreground shell of stars ever
// carries visible labels (readable AND cheap; troika render cost scales
// with visible text count).
const FAR_FADE_START = 260; // labels fully invisible beyond this
const FAR_FADE_END = 165; // fully visible within this
const NEAR_FADE_START = 90; // fade out again when too close (planet view)
const NEAR_FADE_END = 150;
const VISIBLE_OPACITY = 0.3; // below this a text is culled entirely

// Declutter: labels render only for the nearest stars whose billboards do
// not overlap on screen, capped per frame, so a dense industry cluster can't
// collapse into a wall of text. The separation required is computed per
// candidate from its own camera distance: billboards are world-sized, so
// their on-screen width grows as you approach (≈0.55 × chars × fontSize).
const MAX_LABELS = 12;

// Opacity smoothing rate (per second): label opacity eases toward its
// target instead of snapping; most visible when the declutter drops or
// admits a label, which is a binary target jump. ~100ms response.
const SMOOTH_RATE = 10;

const NAME_SIZE = 4.2;
const NAME_CHAR_WIDTH = NAME_SIZE * 0.55; // avg world width of one name char
const SCORE_SIZE = 3.0;
const PLANET_CONTEXT = 0.15; // labels reduce to a faint hint in planet view

const NAME_FILL = '#D6D6E8';
const NAME_OUTLINE = '#030308';
const SCORE_DIM = 0.72; // keep maturity colors under the bloom threshold
// troika (drei <Text>) needs a TTF, and woff2 is not supported
const FONT_URL = '/fonts/Geist-Medium.ttf';

type LabelText = THREE.Object3D & { fillOpacity: number };

/**
 * Billboards a company name + maturity score above every star.
 * Opacity is driven per-label from the camera distance, so labels breathe
 * in as you approach and vanish at galaxy zoom. Gated on zoom so the
 * galaxy view pays nothing for them.
 */
export function StarLabels({
  companies,
  groupRef,
}: {
  companies: Company[];
  groupRef: React.RefObject<THREE.Group>;
}) {
  const [mounted, setMounted] = useState(false);
  const mountedRef = useRef(false);

  useFrame(() => {
    const zoom = useGalaxyStore.getState().zoomLevel;
    let target = mountedRef.current;
    if (!mountedRef.current && zoom < MOUNT_ZOOM) target = true;
    if (mountedRef.current && zoom > UNMOUNT_ZOOM) target = false;
    if (target !== mountedRef.current) {
      mountedRef.current = target;
      setMounted(target);
    }
  });

  if (!mounted) return null;
  return <Labels companies={companies} groupRef={groupRef} />;
}

function Labels({
  companies,
  groupRef,
}: {
  companies: Company[];
  groupRef: React.RefObject<THREE.Group>;
}) {
  const nameRefs = useRef<(LabelText | null)[]>([]);
  const scoreRefs = useRef<(LabelText | null)[]>([]);
  const nameOpacity = useRef(new Float32Array(companies.length));
  const scoreOpacity = useRef(new Float32Array(companies.length));
  const worldPos = useRef(new THREE.Vector3());
  const ndc = useRef(new THREE.Vector3());
  const camDist = useRef(new Float32Array(companies.length));
  const frontZ = useRef(new Float32Array(companies.length)); // view-space z (neg = in front of camera)
  const screenX = useRef(new Float32Array(companies.length));
  const screenY = useRef(new Float32Array(companies.length));
  const dirVec = useRef(new THREE.Vector3());
  const tmpVec = useRef(new THREE.Vector3());
  const kept = useRef(new Set<number>());
  const keptScreen = useRef<{ x: number; y: number }[]>([]);
  const mountStart = useRef(0);

  const stars = useMemo(
    () =>
      companies.map((c) => ({
        id: c.id,
        name: c.name,
        score: c.maturity.overall,
        color: dimHex(maturityColor(c.maturity.overall), SCORE_DIM),
        position: new THREE.Vector3(c.position.x, c.position.y, c.position.z),
      })),
    [companies]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (mountStart.current === 0) mountStart.current = t;
    const mountFade = smoothstep(mountStart.current, mountStart.current + 0.9, t);

    // Frame-rate-independent exponential smoothing: opacity eases toward its
    // target rather than snapping (getDelta is unused elsewhere, so this is
    // the frame's true delta).
    const delta = Math.min(state.clock.getDelta(), 0.1);
    const alpha = 1 - Math.exp(-delta * SMOOTH_RATE);

    const camera = state.camera;
    const { mode, selectedStar } = useGalaxyStore.getState();
    const selectedId = mode === 'planet' ? selectedStar?.id : null;

    // Pass 1: camera distance + screen projection + front/back for every star.
    camera.getWorldDirection(dirVec.current);
    for (let i = 0; i < stars.length; i++) {
      worldPos.current.copy(stars[i].position);
      if (groupRef.current) groupRef.current.localToWorld(worldPos.current);
      camDist.current[i] = camera.position.distanceTo(worldPos.current);
      // Positive = in front of the camera (behind-camera stars mirror to the
      // wrong screen position and must never be labeled).
      frontZ.current[i] = tmpVec.current
        .copy(worldPos.current)
        .sub(camera.position)
        .dot(dirVec.current);
      ndc.current.copy(worldPos.current).project(camera);
      screenX.current[i] = ndc.current.x;
      screenY.current[i] = ndc.current.y;
    }

    // Pass 2: choose which labels actually show: nearest star first, skip
    // any whose billboard would overlap an already-kept one on screen. The
    // required separation scales with the candidate's distance, since the
    // billboard's pixel width grows as the camera approaches.
    // The app always uses a perspective camera.
    const fovScale = 2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360);
    const order = Array.from({ length: stars.length }, (_, i) => i).sort(
      (a, b) => camDist.current[a] - camDist.current[b]
    );
    kept.current.clear();
    keptScreen.current.length = 0;
    for (const i of order) {
      if (kept.current.size >= MAX_LABELS) break;
      // Only stars in the visible shell are label candidates: in front of the
      // camera, inside the far-fade band, and on screen. Behind/too-close
      // stars are near-faded to nothing, so keeping them would only shadow the
      // readable ones via the separation check.
      if (
        frontZ.current[i] < 0 ||
        camDist.current[i] < NEAR_FADE_END ||
        camDist.current[i] > FAR_FADE_START ||
        screenX.current[i] < -1.05 ||
        screenX.current[i] > 1.05 ||
        screenY.current[i] < -1.05 ||
        screenY.current[i] > 1.05
      )
        continue;
      // NDC separation needed so this name billboard clears already-kept ones.
      const pxPerUnit = state.size.height / (fovScale * camDist.current[i]);
      const requiredSep =
        (stars[i].name.length * NAME_CHAR_WIDTH * pxPerUnit) / state.size.width;
      if (
        keptScreen.current.some(
          (k) =>
            Math.hypot(k.x - screenX.current[i], k.y - screenY.current[i]) <
            requiredSep
        )
      )
        continue;
      kept.current.add(i);
      keptScreen.current.push({ x: screenX.current[i], y: screenY.current[i] });
    }

    // Pass 3 (per-label opacity): kept labels fade normally, the rest go dark.
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const far = smoothstep(FAR_FADE_START, FAR_FADE_END, camDist.current[i]);
      const near = smoothstep(NEAR_FADE_START, NEAR_FADE_END, camDist.current[i]);
      const hidden = selectedId === star.id ? 0 : 1;
      const modeFactor = mode === 'planet' ? PLANET_CONTEXT : 1;
      const target =
        mountFade * far * near * hidden * modeFactor * (kept.current.has(i) ? 1 : 0);

      const name = nameRefs.current[i];
      if (name) {
        const prev = nameOpacity.current[i];
        const next = prev + (target - prev) * alpha;
        if (Math.abs(next - prev) > 0.0005) {
          nameOpacity.current[i] = next;
          name.fillOpacity = next;
          name.visible = next > VISIBLE_OPACITY;
        }
      }
      const score = scoreRefs.current[i];
      if (score) {
        const prev = scoreOpacity.current[i];
        const next = prev + (target - prev) * alpha;
        if (Math.abs(next - prev) > 0.0005) {
          scoreOpacity.current[i] = next;
          score.fillOpacity = next;
          score.visible = next > VISIBLE_OPACITY;
        }
      }
    }
  });

  return (
    <group>
      {stars.map((star, i) => (
        <Billboard key={star.id}>
          <Text
            ref={(el) => {
              nameRefs.current[i] = el as unknown as LabelText;
            }}
            position={[0, 7.2, 0]}
            fontSize={NAME_SIZE}
            letterSpacing={0.04}
            anchorX="center"
            anchorY="middle"
            font={FONT_URL}
            color={NAME_FILL}
            outlineWidth={0.06}
            outlineColor={NAME_OUTLINE}
            fillOpacity={0}
            visible={false}
          >
            {star.name}
          </Text>
          <Text
            ref={(el) => {
              scoreRefs.current[i] = el as unknown as LabelText;
            }}
            position={[0, 4.2, 0]}
            fontSize={SCORE_SIZE}
            letterSpacing={0.04}
            color={star.color}
            anchorX="center"
            anchorY="middle"
            font={FONT_URL}
            fillOpacity={0}
            visible={false}
          >
            {star.score}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}

/** Scale an sRGB hex color by a linear multiplier, returning a dimmed hex. */
function dimHex(hex: string, factor: number): string {
  const color = new THREE.Color(hex).multiplyScalar(factor);
  return `#${color.getHexString()}`;
}
