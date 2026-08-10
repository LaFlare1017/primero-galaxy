'use client';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

/**
 * UnrealBloom (strength 1.2, threshold 0.7) + ACESFilmic tone mapping.
 * ACES/sRGB output comes from three's OutputPass, which @react-three/
 * postprocessing appends automatically based on the renderer defaults.
 */
export function PostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={1.2}
        luminanceThreshold={0.7}
        luminanceSmoothing={0.3}
        radius={0.8}
        mipmapBlur
      />
    </EffectComposer>
  );
}
