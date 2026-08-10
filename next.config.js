/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Company logos come from the Google favicon service (tiny 128px tiles,
    // unoptimized — no image-optimizer round-trip needed).
    remotePatterns: [{ protocol: 'https', hostname: 'www.google.com' }],
  },
};

module.exports = nextConfig;
