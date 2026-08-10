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

// Three.js must never run on the server; load it client-side only.
const GalaxyScene = dynamic(() => import('./GalaxyScene'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-void" />,
});

export default function GalaxyApp({ companies: baseCompanies }: { companies: Company[] }) {
  const userStars = useGalaxyStore((s) => s.userStars);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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

  return (
    <div className="fixed inset-0 overflow-hidden">
      <GalaxyScene companies={companies} />
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
