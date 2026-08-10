'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Company } from '@/types';
import { maturityColor } from '@/lib/constants';
import { faviconUrl, monogram } from '@/lib/utils';

/**
 * Company logo tile. Fetches the brand mark from the company's official
 * domain via the favicon service; if the fetch fails (or the company has no
 * domain, e.g. user-added stars) it falls back to a maturity-tinted monogram
 * so the profile header never shows a broken image.
 */
export function CompanyLogo({
  company,
  size = 'md',
}: {
  company: Company;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [company.id]);

  const frame =
    size === 'sm'
      ? 'h-7 w-7 rounded-md p-0.5 text-[9px]'
      : 'h-11 w-11 rounded-lg p-1 text-[13px]';
  const color = maturityColor(company.maturity.overall);

  if (company.domain && !failed) {
    return (
      <Image
        src={faviconUrl(company.domain)}
        alt=""
        width={128}
        height={128}
        unoptimized
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${frame} shrink-0 border border-border-subtle bg-white object-contain`}
      />
    );
  }

  return (
    <span
      className={`${frame} flex shrink-0 items-center justify-center border border-border-subtle font-semibold`}
      style={{ color, backgroundColor: `${color}14` }}
    >
      {monogram(company.name)}
    </span>
  );
}
