'use client';

import { useEffect, useState } from 'react';
import { canUseWebGL } from '@/components/galaxy/WebGLFallback';

/**
 * Hero-side WebGL availability probe for the landing page. The galaxy is a
 * Three.js scene, so a browser without WebGL can't render it; rather than
 * letting visitors discover that after clicking "Enter the galaxy" (and
 * landing on the fallback screen), the notice appears under the hero CTA the
 * moment the probe resolves.
 *
 * Most visitors never see it: the probe runs after first paint and renders
 * nothing when WebGL is available, so there is no flash or layout shift for
 * the supported path.
 */
export function WebGLNotice() {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  useEffect(() => {
    setWebglOk(canUseWebGL());
  }, []);

  // First paint (unknown) or supported: render nothing.
  if (webglOk !== false) return null;

  return (
    <p
      role="status"
      className="mt-5 max-w-[62ch] rounded-md border border-maturity-mid/30 bg-maturity-mid/10 px-4 py-3 text-left text-[13px] leading-relaxed text-maturity-mid"
    >
      Your browser has WebGL turned off, so the 3D galaxy can&apos;t render here.
      You can still explore the{' '}
      <a
        href="/methodology"
        className="underline decoration-maturity-mid/50 underline-offset-2 transition hover:text-star-bright hover:decoration-maturity-mid"
      >
        full methodology and every company&apos;s research trail
      </a>{' '}
      without the 3D view.
    </p>
  );
}
