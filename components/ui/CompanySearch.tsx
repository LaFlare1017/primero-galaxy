'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Company } from '@/types';
import { useGalaxyStore } from '@/store/galaxyStore';
import { maturityColor } from '@/lib/constants';

const EASE = [0.16, 1, 0.3, 1] as const;
const MAX_RESULTS = 8;

/**
 * "Search by company": a floating search palette at the top of the galaxy.
 * Type a name and the results narrow to matching stars (dataset + user-added);
 * clicking one (or Enter) selects it; the camera flies in and the full
 * profile panel opens. The galaxy stays visible behind the panel, and the
 * transparent click-catcher closes it on any outside click (Esc too).
 */
export function CompanySearch({
  open,
  onClose,
  companies,
}: {
  open: boolean;
  onClose: () => void;
  companies: Company[];
}) {
  const selectStar = useGalaxyStore((s) => s.selectStar);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Case-insensitive substring match on company name (dataset + user stars).
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return companies
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [companies, query]);

  // Reset transient state and focus the input each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  const selectCompany = (company: Company) => {
    selectStar(company); // store: planet mode + camera target → fly-in
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? Math.min(i + 1, results.length - 1) : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[activeIndex];
      if (hit) selectCompany(hit);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40">
          {/* Transparent click-catcher: closes on any outside click without
              dimming the galaxy behind the palette. */}
          <div className="absolute inset-0" onClick={onClose} />

          <motion.div
            className="absolute inset-x-0 top-4 flex justify-center px-4"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-border-subtle bg-nebula/95 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl">
              {/* Input row */}
              <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0 text-ui-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21 L 16.5 16.5" />
                </svg>
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-label="Search companies"
                  aria-expanded={open && results.length > 0}
                  aria-controls="company-search-listbox"
                  aria-activedescendant={
                    results[activeIndex] ? `search-opt-${results[activeIndex].id}` : undefined
                  }
                  aria-autocomplete="list"
                  placeholder={`Search ${companies.length} companies…`}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  onKeyDown={onKeyDown}
                  className="w-full bg-transparent text-sm text-star-bright outline-none placeholder:text-ui-muted/60"
                />
                <kbd
                  aria-hidden="true"
                  className="shrink-0 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium text-ui-muted"
                >
                  esc
                </kbd>
              </div>

              {/* Results */}
              <ul
                id="company-search-listbox"
                role="listbox"
                aria-label="Companies"
                className="max-h-72 overflow-y-auto p-1.5"
              >
                {query.trim() === '' ? (
                  <li className="px-3 py-2.5 text-xs text-ui-muted">
                    Type a company name to jump straight to its star.
                  </li>
                ) : results.length === 0 ? (
                  <li className="px-3 py-2.5 text-xs text-ui-muted">
                    No companies match “{query.trim()}”.
                  </li>
                ) : (
                  results.map((company, i) => (
                    <li
                      key={company.id}
                      id={`search-opt-${company.id}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => selectCompany(company)}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 transition-colors ${
                        i === activeIndex ? 'bg-trajectory/10' : ''
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: maturityColor(company.maturity.overall) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-star-bright">
                        {company.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-ui-muted">{company.industry}</span>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                        style={{
                          color: maturityColor(company.maturity.overall),
                          backgroundColor: `${maturityColor(company.maturity.overall)}1f`,
                        }}
                      >
                        {company.maturity.overall}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
