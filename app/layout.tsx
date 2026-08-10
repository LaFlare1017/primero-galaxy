import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

// Absolute base for OG/twitter image URLs and the canonical link. Set
// NEXT_PUBLIC_SITE_URL at deploy time (see .env.local.example and the CI
// secret); the localhost fallback keeps local builds deterministic. The
// value is trimmed so an unset or empty CI secret falls back safely.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Primero Galaxy — The AI Transformation Maturity Galaxy',
  description:
    'An explorable galaxy where every star is a Fortune 500 enterprise and every trajectory is a path to AI maturity. Real companies. One universe. Explore.',
  keywords: [
    'AI transformation',
    'AI maturity',
    'Fortune 500 AI',
    'enterprise AI adoption',
    'maturity model',
    'data visualization',
    '3D galaxy',
    'Primero',
  ],
  authors: [{ name: 'Primero' }],
  openGraph: {
    title: 'Primero Galaxy — The AI Transformation Maturity Galaxy',
    description: 'A 3D galaxy of Fortune 500 enterprises, scored on estimated AI maturity from public disclosures. One universe. Explore.',
    type: 'website',
    siteName: 'Primero Galaxy',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Primero Galaxy — The AI Transformation Maturity Galaxy',
    description: 'A 3D galaxy of Fortune 500 enterprises, scored on estimated AI maturity from public disclosures.',
  },
};

export const viewport: Viewport = {
  themeColor: '#030308',
  width: 'device-width',
  initialScale: 1,
  // No maximum-scale: pinching to zoom must stay available (WCAG 1.4.4).
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="bg-void text-star-bright antialiased">{children}</body>
    </html>
  );
}
