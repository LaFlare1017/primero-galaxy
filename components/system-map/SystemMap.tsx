'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { canUseWebGL } from '@/components/galaxy/WebGLFallback';
import { GOLDEN_PATH, LAYERS, LAYER_BY_ID, NODE_BY_ID, NODES, type EdgeKind, type LayerId } from './map-data';

const SystemMapScene = dynamic(() => import('./SystemMapScene').then((m) => m.SystemMapScene), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-void" />,
});

const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  payload: 'Payload · Company[] data flow (animated)',
  dependency: 'Dependency · import',
  control: 'Control · event / state',
};

const EDGE_KIND_COLOR: Record<EdgeKind, string> = {
  payload: '#E8F6F4',
  dependency: '#7B61FF',
  control: '#F7C548',
};

export function SystemMap() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);

  useEffect(() => {
    setWebglOk(canUseWebGL());
  }, []);

  const selected = selectedId ? NODE_BY_ID[selectedId] : null;
  const hovered = hoveredId ? NODE_BY_ID[hoveredId] : null;

  const grouped = useMemo(() => {
    const out: Record<LayerId, typeof NODES> = Object.fromEntries(
      LAYERS.map((l) => [l.id, [] as typeof NODES])
    ) as Record<LayerId, typeof NODES>;
    for (const n of NODES) out[n.layer].push(n);
    return out;
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-void text-star-bright">
      {/* 3D scene */}
      {webglOk === false ? (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
          <div className="max-w-md rounded-xl border border-border-subtle bg-void/80 p-6">
            <p className="text-sm font-semibold text-maturity-mid">
              WebGL is unavailable, so the 3D map can&apos;t render here.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ui-dim">
              The legend and explainer below still map the full architecture with file citations.
            </p>
          </div>
        </div>
      ) : (
        <SystemMapScene
          hoveredId={hoveredId}
          selectedId={selectedId}
          onHover={setHoveredId}
          onSelect={setSelectedId}
        />
      )}

      {/* Header */}
      <div className="pointer-events-none absolute left-4 top-4 z-10">
        <p className="text-[11px] font-semibold uppercase tracking-label text-trajectory">
          Repository · isometric system map
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-title">Primero Galaxy architecture</h1>
        <p className="mt-1 max-w-[52ch] text-[12px] leading-relaxed text-ui-dim">
          Every building is a module; every arc is a real import, data flow, or control path.
          Hover or click a building to see its files.
        </p>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 max-w-[260px] rounded-xl border border-border-subtle bg-void/85 p-3 backdrop-blur-sm">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-label text-ui-muted">
          Layers
        </p>
        <ul className="space-y-1">
          {LAYERS.map((l) => (
            <li key={l.id} className="flex items-start gap-2">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: l.color }}
              />
              <span className="text-[11px] leading-tight text-ui-dim">
                <span className="font-semibold text-star-bright/90">{l.label}</span> · {l.note}
              </span>
            </li>
          ))}
        </ul>
        <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-label text-ui-muted">
          Arcs
        </p>
        <ul className="space-y-1">
          {(Object.keys(EDGE_KIND_LABEL) as EdgeKind[]).map((k) => (
            <li key={k} className="flex items-start gap-2">
              <span
                className="mt-1.5 h-0.5 w-4 shrink-0"
                style={{ backgroundColor: EDGE_KIND_COLOR[k] }}
              />
              <span className="text-[11px] leading-tight text-ui-dim">{EDGE_KIND_LABEL[k]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Explainer panel */}
      <aside className="absolute bottom-4 right-4 top-4 z-10 flex w-[340px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-void/85 backdrop-blur-sm max-md:left-4 max-md:top-auto max-md:w-auto">
        <div className="border-b border-border-subtle p-3">
          <p className="text-[10px] font-semibold uppercase tracking-label text-ui-muted">
            Golden path · the Company[] payload
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ui-dim">
            {GOLDEN_PATH.map((id) => NODE_BY_ID[id].name).join(' → ')}
            <span className="text-ui-muted"> · + a branch to api/companies</span>
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selected ? (
            <div className="rounded-lg border border-border-subtle bg-void/60 p-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: LAYER_BY_ID[selected.layer].color }}
                />
                <h2 className="text-sm font-semibold">{selected.name}</h2>
              </div>
              <p className="mt-1 text-[11px] font-medium text-ui-muted">{selected.role}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-ui-dim">{selected.detail}</p>
              <div className="mt-3 border-t border-border-subtle pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-label text-ui-muted">
                  Cited files
                </p>
                <ul className="mt-1 space-y-1">
                  <li className="font-mono text-[11px] text-maturity-high">{selected.file}</li>
                  {selected.files?.map((f) => (
                    <li key={f} className="font-mono text-[11px] text-maturity-high">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="mt-3 text-[11px] font-medium text-ui-muted underline-offset-2 hover:text-star-bright hover:underline"
              >
                Back to full index
              </button>
            </div>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-ui-dim">
                Select a building to read its role and the files behind it. Payload arcs are
                animated: they trace the dataset from{' '}
                <span className="font-mono text-[11px] text-maturity-high">
                  lib/fortune500-data.ts
                </span>{' '}
                through layout, the SSR page, the scene graph, and finally the instanced star mesh.
              </p>
              <div className="mt-3 space-y-3">
                {LAYERS.map((l) => (
                  <div key={l.id}>
                    <p
                      className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-label"
                      style={{ color: l.color }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                      {l.label}
                    </p>
                    <ul className="space-y-0.5">
                      {grouped[l.id].map((n) => (
                        <li key={n.id}>
                          <button
                            onClick={() => setSelectedId(n.id)}
                            onMouseEnter={() => setHoveredId(n.id)}
                            onMouseLeave={() => setHoveredId(null)}
                            className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                              selectedId === n.id
                                ? 'bg-white/10'
                                : 'hover:bg-white/5'
                            }`}
                          >
                            <span className="truncate text-[12px] font-medium text-star-bright/90">
                              {n.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-ui-muted">
                              {n.file.split('/').pop()}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
