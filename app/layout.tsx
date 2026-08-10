import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
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
  maximumScale: 1,
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
