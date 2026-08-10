'use client';
import { useGalaxyStore } from '@/store/galaxyStore';
import { cn } from '@/lib/utils';

const MODES = [
  { id: 'galaxy', label: 'Galaxy', dot: '#4A4A6A' },
  { id: 'constellation', label: 'Constellation', dot: '#F7C548' },
  { id: 'planet', label: 'Planet', dot: '#00D9C0' },
] as const;

export function ModeIndicator() {
  const selectedStar = useGalaxyStore((s) => s.selectedStar);
  const zoomLevel = useGalaxyStore((s) => s.zoomLevel);

  const mode = selectedStar ? 'planet' : zoomLevel < 400 ? 'constellation' : 'galaxy';
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-label text-ui-muted">
      {MODES.map((m) => (
        <span key={m.id} className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: m.dot,
              opacity: m.id === mode ? 1 : 0.22,
            }}
          />
          <span className={cn(m.id === mode ? 'text-star-bright' : '')}>{m.label}</span>
        </span>
      ))}
      <span className="sr-only">Current mode: {active.label}</span>
    </div>
  );
}
