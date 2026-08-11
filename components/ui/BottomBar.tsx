'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { ModeIndicator } from './ModeIndicator';

const SHARE_TITLE = 'The AI Transformation Galaxy';
const SHARE_TEXT =
  'Fly through the galaxy: Fortune 500 companies on their AI maturity journey.';

/** Legacy clipboard fallback for insecure contexts where the async API is blocked. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Async clipboard blocked (insecure context, permissions): last resort.
    if (!legacyCopy(text)) throw new Error('clipboard unavailable');
  }
}

export function BottomBar({
  companies,
  onSearch,
  onAddCompany,
}: {
  companies: Company[];
  onSearch: () => void;
  onAddCompany: () => void;
}) {
  const clearSelection = useGalaxyStore((s) => s.clearSelection);
  const [visible, setVisible] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'done' | 'error'>('idle');
  const shareResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear a pending feedback reset on unmount so state never updates after.
  useEffect(
    () => () => {
      if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
    },
    []
  );

  /**
   * Native share sheet where the Web Share API exists (mobile + desktop
   * Chromium/Safari); otherwise copy the current URL to the clipboard. The
   * button flips to a short-lived "Copied" state either way. A cancelled
   * share sheet (AbortError) is user intent, not a failure, so it is silent.
   */
  async function onShare() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url });
          setShareState('done');
        } catch (err) {
          // User dismissed the sheet: no feedback, no fallback.
          if (err instanceof DOMException && err.name === 'AbortError') return;
          await copyToClipboard(url);
          setShareState('done');
        }
      } else {
        await copyToClipboard(url);
        setShareState('done');
      }
    } catch {
      setShareState('error');
    }
    if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
    shareResetTimer.current = setTimeout(() => setShareState('idle'), 2400);
  }

  // Fade in at 4.4s, strictly AFTER the LandingTitle overlay unmounts
  // (4.2s), so the two z-20 layers never share the screen. Keep in sync
  // with LandingTitle's sequence if either timing changes.
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 4400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <motion.div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex h-14 items-center justify-between px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      <div className="bg-gradient-to-t from-void/90 to-transparent absolute inset-0 -z-10" />

      {/* Left: wordmark + stats */}
      <div className="flex items-baseline gap-3">
        <span className="text-[13px] font-semibold tracking-[0.18em] text-star-bright max-[560px]:text-[11px]">
          PRIMERO GALAXY
        </span>
        <span className="text-[11px] text-ui-muted">
          {companies.length} stars · {new Set(companies.map((c) => c.industry)).size} industries
        </span>
      </div>

      {/* Center: mode + controls hint */}
      <div className="hidden items-center gap-6 md:flex">
        <ModeIndicator />
        <span className="text-[11px] tracking-wide text-ui-muted">
          Drag to orbit · Scroll to zoom · Double-click to explore
        </span>
      </div>

      {/* Right: actions */}
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          onClick={clearSelection}
          className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-ui-dim transition-colors hover:border-star-dim hover:text-star-bright"
          title="Reset view (Esc)"
        >
          Reset view
        </button>
        <button
          onClick={onSearch}
          className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-ui-dim transition-colors hover:border-star-dim hover:text-star-bright"
          title="Search companies by name"
        >
          Search
        </button>
        <button
          onClick={onAddCompany}
          className="rounded-md border border-trajectory/50 px-3 py-1.5 text-[12px] font-medium text-trajectory transition-colors hover:bg-trajectory/10 hover:border-trajectory"
          title="Add your company to the galaxy"
        >
          Add Company
        </button>
        <button
          onClick={onShare}
          aria-label="Share galaxy"
          title="Share the galaxy"
          className="flex items-center gap-1.5 rounded-md border border-border-subtle px-3 py-1.5 text-[12px] font-medium text-ui-dim transition-colors hover:border-star-dim hover:text-star-bright"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 15V3m0 0 4 4m-4-4L8 7" />
            <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          </svg>
          <span>{shareState === 'done' ? 'Copied' : shareState === 'error' ? 'Failed' : 'Share'}</span>
        </button>
        <span role="status" className="sr-only">
          {shareState === 'done' ? 'Link copied to clipboard' : shareState === 'error' ? 'Copy failed' : ''}
        </span>
      </div>
    </motion.div>
  );
}
