'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { INDUSTRIES, Industry } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { createUserCompany } from '@/lib/user-company';
import { maturityColor, maturityLabel } from '@/lib/constants';
import { slugify } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * "Add Your Company" flow (handoff §5.6): a minimal bottom sheet with name,
 * industry, and a current-AI-status slider. On submit the new star is added
 * to the store (persisted to localStorage), selected (camera flies to it),
 * and the store pushes the "Your company is here" toast.
 */
export function AddCompanyForm({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addUserStar = useGalaxyStore((s) => s.addUserStar);
  const selectStar = useGalaxyStore((s) => s.selectStar);
  const userStars = useGalaxyStore((s) => s.userStars);
  const removeUserStar = useGalaxyStore((s) => s.removeUserStar);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState<Industry>('Technology');
  const [aiStatus, setAiStatus] = useState(45);

  // Esc closes the sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset transient fields each time the sheet opens
  useEffect(() => {
    if (open) {
      setName('');
      setAiStatus(45);
    }
  }, [open]);

  // Same slug as an existing star = the same company (the store keys on slug
  // too, so toast dedupe and this check agree). Case- and whitespace-insensitive.
  const duplicate = userStars.some((s) => s.slug === slugify(name));
  const canSubmit = name.trim().length > 0 && !duplicate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const company = createUserCompany({ name, industry, aiStatus });
    addUserStar(company); // also pushes the "Your company is here" toast
    selectStar(company); // flies the camera to the new star
    onClose();
  };

  const fieldClass =
    'w-full rounded-md border border-border-subtle bg-void/80 px-3 py-2 text-sm text-star-bright outline-none transition-colors placeholder:text-ui-muted/60 focus:border-star-dim';
  const labelClass = 'mb-1.5 block text-[11px] font-medium uppercase tracking-label text-ui-muted';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-void/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />

          {/* Bottom sheet */}
          <motion.form
            onSubmit={handleSubmit}
            className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-2xl border-t border-x border-border-subtle bg-nebula/95 px-6 pb-8 pt-5 shadow-[0_-20px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-title text-star-bright">Add Your Company</h2>
                <p className="mt-0.5 text-xs text-ui-muted">
                  Place your company in the galaxy and see its trajectory.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-sm text-ui-muted transition-colors hover:text-star-bright"
              >
                ✕
              </button>
            </div>

            {/* Company name */}
            <div className="mb-4">
              <label className="block">
                <span className={labelClass}>Company name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Meridian Logistics"
                  autoFocus
                  aria-invalid={duplicate && name.trim().length > 0}
                  aria-describedby={duplicate ? 'company-name-error' : undefined}
                  className={fieldClass}
                />
              </label>
              {duplicate && name.trim().length > 0 && (
                <p
                  id="company-name-error"
                  role="alert"
                  className="mt-1.5 text-xs font-medium text-[#F87171]"
                >
                  This company is already in your galaxy.
                </p>
              )}
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3">
              {/* Industry */}
              <label className="block">
                <span className={labelClass}>Industry</span>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value as Industry)}
                  className={fieldClass}
                >
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i} className="bg-nebula">
                      {i}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Current AI status */}
            <label className="mb-6 block">
              <span className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11px] font-medium uppercase tracking-label text-ui-muted">
                  Current AI status
                </span>
                <span
                  className="text-sm font-semibold tabular-nums"
                  style={{ color: maturityColor(aiStatus) }}
                >
                  {aiStatus}
                  <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-label"
                    style={{
                      color: maturityColor(aiStatus),
                      backgroundColor: `${maturityColor(aiStatus)}1f`,
                    }}
                  >
                    {maturityLabel(aiStatus)}
                  </span>
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={aiStatus}
                onChange={(e) => setAiStatus(Number(e.target.value))}
                aria-label="Current AI status"
                className="w-full accent-[#7B61FF]"
              />
              <div className="mt-1 flex justify-between text-[10px] text-ui-muted/60">
                <span>0 · Getting started</span>
                <span>100 · Fully transformed</span>
              </div>
            </label>

            {/* Your stars: manage previously added companies */}
            {userStars.length > 0 && (
              <div className="mb-6 border-t border-border-subtle pt-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-label text-ui-muted">
                    Your stars
                  </span>
                  <span className="text-[10px] tabular-nums text-ui-muted/70">
                    {userStars.length}
                  </span>
                </div>
                <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {userStars.map((star) => (
                    <li
                      key={star.id}
                      className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-void/60 px-3 py-2"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: maturityColor(star.maturity.overall) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-star-bright">
                        {star.name}
                      </span>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                        style={{
                          color: maturityColor(star.maturity.overall),
                          backgroundColor: `${maturityColor(star.maturity.overall)}1f`,
                        }}
                      >
                        {star.maturity.overall}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeUserStar(star.id)}
                        aria-label={`Remove ${star.name}`}
                        className="shrink-0 rounded px-1 text-xs text-ui-muted transition-colors hover:text-[#F87171]"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-md bg-[#7B61FF] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#8B71FF] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add to galaxy ✦
            </button>
          </motion.form>
        </div>
      )}
    </AnimatePresence>
  );
}
