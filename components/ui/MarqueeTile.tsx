'use client';
import { useState } from 'react';
import Image from 'next/image';
import { marqueeLogoUrl, monogram } from '@/lib/utils';

/**
 * One logo tile in the landing-page marquee. For the 20 largest companies it
 * renders a bundled crisp white mark (high-resolution, monochrome) that stays
 * sharp at any DPR; for the rare brand whose mark is missing it falls back to
 * the favicon service. If the fetch fails it degrades to a maturity-tinted
 * monogram so the strip never shows a broken image. The mark is decorative
 * (empty alt): the company names themselves are exposed to screen readers in a
 * static list by CompanyMarquee. The tile sits on the transparent page surface
 * (no white chip) so white marks read cleanly over the dark background.
 */
export function MarqueeTile({
  name,
  domain,
  color,
}: {
  name: string;
  domain?: string;
  color: string;
}) {
  const [failed, setFailed] = useState(false);

  const src = marqueeLogoUrl(domain);

  if (src && !failed) {
    return (
      <Image
        src={src}
        alt=""
        width={384}
        height={120}
        unoptimized
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-10 w-auto shrink-0 object-contain px-1"
      />
    );
  }

  return (
    <span
      className="flex h-10 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-white/[0.03] px-3 text-[11px] font-semibold"
      style={{ color }}
    >
      {monogram(name)}
    </span>
  );
}
