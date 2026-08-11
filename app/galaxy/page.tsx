import type { Metadata } from 'next';
import { getCompanies } from '@/lib/data-generator';
import { COMPANY_COUNT } from '@/lib/fortune500-data';
import GalaxyApp from '@/components/galaxy/GalaxyApp';

export const metadata: Metadata = {
  title: 'The AI Transformation Galaxy | Primero Galaxy',
  description:
    "Fly through the galaxy of Fortune 500 companies. Zoom from galaxy to constellation to planet, inspect each company's five maturity dimensions, and follow its transformation trajectory.",
  alternates: { canonical: '/galaxy' },
  openGraph: {
    title: 'The AI Transformation Galaxy | Primero Galaxy',
    description:
      'Fly through a 3D galaxy of Fortune 500 companies, inspect their AI maturity dimensions, and follow transformation trajectories.',
    url: '/galaxy',
    type: 'website',
    images: [{ url: '/og', width: 1200, height: 630, alt: 'The AI Transformation Galaxy' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The AI Transformation Galaxy | Primero Galaxy',
    description:
      'Fly through a 3D galaxy of Fortune 500 companies, inspect their AI maturity dimensions, and follow transformation trajectories.',
    images: ['/og'],
  },
};

export default function GalaxyPage() {
  const companies = getCompanies(COMPANY_COUNT);
  return <GalaxyApp companies={companies} />;
}
