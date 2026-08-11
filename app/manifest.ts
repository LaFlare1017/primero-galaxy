import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Primero Galaxy: The AI Transformation Maturity Galaxy',
    short_name: 'Primero Galaxy',
    description:
      'An explorable 3D galaxy where every star is a Fortune 500 enterprise on its AI transformation journey.',
    start_url: '/',
    display: 'standalone',
    background_color: '#030308',
    theme_color: '#030308',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
