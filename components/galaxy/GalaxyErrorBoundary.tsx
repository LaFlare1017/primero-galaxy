'use client';

import { Component, ReactNode } from 'react';
import { WebGLFallback } from './WebGLFallback';

/**
 * Catches renderer exceptions from the 3D scene (a WebGL context failure,
 * shader compile error, or GPU-driver crash) so visitors never see Next.js's
 * raw "Application error" boundary page. On error it swaps to the same
 * graceful fallback used by the WebGL capability pre-check.
 */
export class GalaxyErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Surface the real cause in the console for diagnosis; the UI shows the
    // explanatory fallback screen instead.
    console.error('Galaxy 3D scene crashed:', error);
  }

  render() {
    return this.state.failed ? <WebGLFallback /> : this.props.children;
  }
}
