/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Isolate the e2e production build from the dev server's cache: dev and
  // prod share .next by default, so a suite run clobbers a running dev
  // server (and vice versa). NEXT_E2E_DIST_DIR points the e2e build at a
  // separate output dir (see playwright.config.ts).
  distDir: process.env.NEXT_E2E_DIST_DIR || '.next',
  images: {
    // Company logos come from the Google favicon service (tiny 128px tiles,
    // unoptimized, so no image-optimizer round-trip needed).
    remotePatterns: [{ protocol: 'https', hostname: 'www.google.com' }],
  },
};

module.exports = nextConfig;
