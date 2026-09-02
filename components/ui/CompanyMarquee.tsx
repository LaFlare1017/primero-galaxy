import { COMPANY_META, FORTUNE500_AI_COMPANIES } from '@/lib/fortune500-data';
import { maturityColor } from '@/lib/constants';
import { MarqueeTile } from './MarqueeTile';

/**
 * Logo marquee under the hero: the 20 largest companies in the dataset by
 * revenue scroll in a seamless loop as a "who we assess" strip. Computed at
 * build time (server component), so only the 20 tile props ship to the client
 * rather than the full dataset. The moving track is decorative (aria-hidden);
 * the company names are exposed to screen readers in a static visually-hidden
 * list, the animation pauses on hover and under reduced motion, and the
 * track's edges fade out via a CSS mask.
 */
const TOP20 = [...FORTUNE500_AI_COMPANIES]
  .sort((a, b) => b.revenue - a.revenue)
  .slice(0, 20)
  .map((company) => ({
    name: company.name,
    domain: COMPANY_META[company.name]?.domain,
    color: maturityColor(company.m[0]),
  }));

export function CompanyMarquee() {
  return (
    <section
      aria-label="AI maturity assessments for the following"
      className="border-y border-border-subtle/40 bg-void/40 py-10"
    >
      <h2 className="px-6 text-center text-[11px] font-semibold uppercase tracking-label text-ui-muted">
        AI maturity assessments for the following:
      </h2>
      <div className="group relative mt-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        {/* Two identical halves (each trailing one gap of padding) make the
            -50% translate loop seamless: the end of the first half lands
            exactly where the second half begins. */}
        <div className="flex w-max animate-marquee motion-reduce:animate-none group-hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              aria-hidden="true"
              className="flex shrink-0 items-center gap-3 pr-3"
            >
              {TOP20.map((company) => (
                <li key={company.name}>
                  <MarqueeTile {...company} />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
      {/* Screen readers get the static list instead of the scrolling track. */}
      <ol className="sr-only">
        {TOP20.map((company) => (
          <li key={company.name}>{company.name}</li>
        ))}
      </ol>
    </section>
  );
}
