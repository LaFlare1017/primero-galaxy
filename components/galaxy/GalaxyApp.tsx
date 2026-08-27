'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { LandingTitle } from '@/components/ui/LandingTitle';
import { Tooltip } from '@/components/ui/Tooltip';
import { BottomBar } from '@/components/ui/BottomBar';
import { PlanetPanel } from '@/components/ui/PlanetPanel';
import { AddCompanyForm } from '@/components/ui/AddCompanyForm';
import { CompanySearch } from '@/components/ui/CompanySearch';
import { ToastStack } from '@/components/ui/ToastStack';
import { canUseWebGL, WebGLFallback } from '@/components/galaxy/WebGLFallback';
import { GalaxyErrorBoundary } from '@/components/galaxy/GalaxyErrorBoundary';

// Three.js must never run on the server; load it client-side only.
const GalaxyScene = dynamic(() => import('./GalaxyScene'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-void" />,
});

export default function GalaxyApp({ companies: baseCompanies }: { companies: Company[] }) {
  const userStars = useGalaxyStore((s) => s.userStars);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  // Probe WebGL on the client only (SSR assumes support to avoid a flash for
  // the overwhelming majority; the probe resolves right after mount).
  useEffect(() => {
    setWebglOk(canUseWebGL());
  }, []);

  // Mount the ~900 kB three.js scene on the browser's first idle slot instead
  // of during the critical path. The bottom bar, search, and add-company
  // controls become interactive immediately; the galaxy pops in a beat later.
  // (requestIdleCallback has a 2.5s ceiling so the scene never starves on a
  // busy thread.)
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setSceneReady(true), { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(() => setSceneReady(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  // Load persisted user stars + any pending "removed" toasts after mount
  // (SSR HTML stays stable). Pending toasts let Undo survive a refresh.
  useEffect(() => {
    useGalaxyStore.getState().hydrateUserStars();
    useGalaxyStore.getState().hydratePendingToasts();
  }, []);

  // Base stars + user stars = everything the galaxy renders
  const companies = useMemo(
    () => (userStars.length === 0 ? baseCompanies : [...baseCompanies, ...userStars]),
    [baseCompanies, userStars]
  );

  // Esc: close the search palette or add form first, otherwise return to the
  // galaxy
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (addOpen) {
        setAddOpen(false);
        return;
      }
      useGalaxyStore.getState().clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, addOpen]);

  // Debug handle (harmless in prod): drive/observe the store from the console
  useEffect(() => {
    const handle = window as unknown as Record<string, unknown>;
    handle.__galaxy = { ...((handle.__galaxy as Record<string, unknown>) ?? {}), store: useGalaxyStore };
  }, []);

  if (webglOk === false) {
    return <WebGLFallback />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      <GalaxyErrorBoundary>
        {sceneReady ? <GalaxyScene companies={companies} /> : <div className="fixed inset-0 bg-void" />}
      </GalaxyErrorBoundary>
      <LandingTitle />
      <Tooltip />
      <PlanetPanel />
      <ToastStack />
      <BottomBar
        companies={companies}
        onSearch={() => {
          setAddOpen(false);
          setSearchOpen(true);
        }}
        onAddCompany={() => {
          setSearchOpen(false);
          setAddOpen(true);
        }}
      />
      <CompanySearch open={searchOpen} onClose={() => setSearchOpen(false)} companies={companies} />
      <AddCompanyForm open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
