import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Deterministic seeded PRNG (mulberry32). Returns a function yielding [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Smoothstep interpolation, clamped to [0, 1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Round to a given number of decimal places. */
export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** kebab-case a display name into a slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Compact a raw number into human units: 317000 → "317k", 2100000 → "2.1M". */
export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${round(value / 1_000_000, 1)}M`;
  if (value >= 1_000) return `${round(value / 1_000, 1)}k`;
  return `${value}`;
}

/** Format an annual-revenue figure stored in $M: 681000 → "$681B", 41000 → "$41B". */
export function formatRevenue(revenueM: number): string {
  if (revenueM >= 1_000) return `$${round(revenueM / 1_000, 1)}B`;
  return `$${revenueM}M`;
}

/**
 * Company-logo URL via the Google favicon service (free, no key). Returns a
 * high-res site icon for the company's official domain.
 */
export function faviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

/**
 * Brands whose official domain has no favicon indexed by Google's favicon
 * service (the request 404s, which would surface as a console error). These
 * ship as local assets in /public/logos, sourced from the companies' own
 * sites or Wikimedia, so the UI never fires a failing request. Keyed by the
 * same domain used everywhere else in the app.
 */
const LOCAL_LOGOS: Record<string, string> = {
  'allstate.com': '/logos/allstate.svg',
  'berkshirehathaway.com': '/logos/berkshire-hathaway.svg',
  'comcast.com': '/logos/comcast.png',
  'conocophillips.com': '/logos/conocophillips.png',
  'danaher.com': '/logos/danaher.svg',
  'dow.com': '/logos/dow.svg',
  'foxcorp.com': '/logos/foxcorp.png',
  'kraftheinzcompany.com': '/logos/kraftheinz.svg',
  'paloaltonetworks.com': '/logos/palo-alto-networks.png',
  'rockwellautomation.com': '/logos/rockwell-automation.png',
};

/**
 * Logo URL for a company: the local asset when the brand's domain has no
 * indexed favicon, otherwise the Google favicon service. Returns null when
 * there is no domain at all (e.g. user-added stars), letting callers fall
 * back to a monogram.
 */
export function logoUrl(domain?: string | null): string | null {
  if (!domain) return null;
  const local = LOCAL_LOGOS[domain];
  if (local) return local;
  return faviconUrl(domain);
}

/** Initials monogram from a company name, the fallback when no logo loads. */
export function monogram(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9 .'-]/g, ' ')
    .split(/[\s.]+/)
    .filter(Boolean);
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
