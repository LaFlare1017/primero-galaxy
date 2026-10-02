/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Isolate the e2e production build from the dev server's cache: dev and
  // prod share .next by default, so a suite run clobbers a running dev
  // server (and vice versa). NEXT_E2E_DIST_DIR points the e2e build at a
  // separate output dir (see playwright.config.ts).
  distDir: process.env.NEXT_E2E_DIST_DIR || '.next',
  // Delegate reads its six scenario briefs from `delegate/scenarios/` at
  // request time (delegate/src/scoring/scenario-loader.ts), and that path is
  // built from the working directory at runtime — nothing in the bundle names
  // it, so Next's file tracer leaves it out of the deployment. A serverless
  // deployment only has the traced files, so without this every scenario load
  // throws `manifest not found` there while the same build answers fine when
  // started from a checkout, which is exactly why it is invisible until deploy.
  // `delegate/data/` is deliberately not listed: it holds participant labels and
  // transcripts, and is gitignored.
  //
  // This has to sit under `experimental` in Next 14 — at the top level the
  // option is not read, and nothing says so: the build is clean, the routes are
  // in the output, and the files are still missing. That is the whole reason
  // the check below is a grep of the emitted traces rather than a read of the
  // config.
  experimental: {
    outputFileTracingIncludes: {
      '/api/delegate/**': ['./delegate/scenarios/**/*'],
      '/delegate/**': ['./delegate/scenarios/**/*'],
    },
  },
  images: {
    // Company logos come from the Google favicon service (tiny 128px tiles,
    // unoptimized, so no image-optimizer round-trip needed).
    remotePatterns: [{ protocol: 'https', hostname: 'www.google.com' }],
  },
};

module.exports = nextConfig;
