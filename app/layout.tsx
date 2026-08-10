import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

// Absolute base for OG/twitter image URLs and the canonical link. Set
// NEXT_PUBLIC_SITE_URL at deploy time (e.g. https://primero-galaxy.vercel.app);
// the localhost fallback keeps local builds deterministic.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Primero Galaxy — The AI Transformation Maturity Galaxy',
  description:
    'An explorable galaxy where every star is a company and every trajectory is a path to AI maturity. 500 companies. One universe. Explore.',
  keywords: [
    'AI transformation',
    'maturity model',
    'ERP',
    'NetSuite',
    'data visualization',
    '3D galaxy',
    'Primero',
  ],
  authors: [{ name: 'Primero' }],
  openGraph: {
    title: 'Primero Galaxy — The AI Transformation Maturity Galaxy',
    description: '500 companies. One universe. Explore.',
    type: 'website',
    siteName: 'Primero Galaxy',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Primero Galaxy — The AI Transformation Maturity Galaxy',
    description: '500 companies. One universe. Explore.',
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
