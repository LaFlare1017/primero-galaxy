import type { Metadata } from 'next';
import { SystemMap } from '@/components/system-map/SystemMap';

export const metadata: Metadata = {
  title: 'System Map | Primero Galaxy',
  description:
    'An isometric map of the Primero Galaxy codebase: every building is a module, every arc a real import, data flow, or control path, with file citations.',
  alternates: { canonical: '/system-map' },
  robots: { index: false, follow: false },
};

export default function SystemMapPage() {
  return <SystemMap />;
}
