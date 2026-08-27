'use client';

/**
 * Graceful degradation screen for browsers that cannot create a WebGL
 * context (hardware acceleration off, GPU blocklisted, remote desktop, or
 * enterprise policy). Without this the Three.js renderer throws and Next.js
 * swaps in the raw "Application error" boundary page; with it, visitors get
 * an explanation and a path forward instead.
 */

/** True when the browser can create a WebGL 2 or WebGL 1 context. */
export function canUseWebGL(): boolean {
  if (typeof document === 'undefined') return true; // SSR: assume supported
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl) {
      // Release the test context immediately; it is only a capability probe.
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Full-screen fallback in the app's visual language. */
export function WebGLFallback() {
  return (
    <main className="fixed inset-0 overflow-y-auto bg-void">
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="max-w-xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-star-bright/70">
            AI Transformation Maturity Visualization
          </p>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-star-bright md:text-3xl">
            The galaxy needs WebGL to render
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ui-muted">
            This 3D visualization requires WebGL, which your browser or device
            is currently blocking or cannot provide. Every star in the galaxy
            is a Fortune 500 company with a fully scored AI transformation
            journey.
          </p>
          <div className="mt-6 space-y-2 text-left text-[13px] leading-relaxed text-ui-muted/90">
            <p>
              <span className="font-semibold text-star-bright/90">On desktop Chrome or Edge:</span>{' '}
              go to Settings → System and turn on &ldquo;Use graphics acceleration when
              available&rdquo;, then restart the browser.
            </p>
            <p>
              <span className="font-semibold text-star-bright/90">Anywhere else:</span> try a
              current version of Chrome, Edge, Firefox, or Safari. WebGL is enabled by default
              in all of them.
            </p>
            <p>
              <span className="font-semibold text-star-bright/90">Still stuck?</span> the full
              scoring methodology and every company&rsquo;s research trail are readable without
              the 3D view.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/methodology"
              className="inline-flex items-center rounded-md border border-star-bright/25 px-5 py-2.5 text-[13px] font-medium text-star-bright transition-colors hover:border-star-bright/60 hover:bg-star-bright/5"
            >
              Read the methodology
            </a>
            <a
              href="/"
              className="inline-flex items-center rounded-md px-5 py-2.5 text-[13px] font-medium text-ui-muted transition-colors hover:text-star-bright"
            >
              ← Back to home
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
