import Link from 'next/link';
import type { Metadata } from 'next';
import { ContactForm } from '@/components/ui/ContactForm';
import HeroStarfield from '@/components/ui/HeroStarfield';
import { Reveal } from '@/components/ui/Reveal';
import { WebGLNotice } from '@/components/ui/WebGLNotice';
import { DIMENSIONS } from '@/lib/constants';
import { COMPANY_COUNT } from '@/lib/fortune500-data';

export const metadata: Metadata = {
  title: 'Primero Galaxy: An Explorable AI Transformation Galaxy',
  description:
    'Every star is a Fortune 500 enterprise. Every constellation is a transformation strategy. Every trajectory is a path to AI maturity. Explore real companies in 3D.',
  alternates: { canonical: '/' },
};

/* ── page ────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="bg-void">
      {/* ─── Hero: full-bleed starfield ─────────────────────────── */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 text-center">
        <HeroStarfield />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_65%_at_50%_50%,transparent_35%,rgba(3,3,8,0.55)_100%)]"
        />
        <div className="relative z-10 flex max-w-3xl flex-col items-center">
          <p
            className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-trajectory"
            style={{ animation: 'fadeIn 0.8s ease-out both' }}
          >
            Independent research · Fortune 500 · AI maturity estimates
          </p>
          <h1
            className="text-lift mt-6 text-5xl font-extrabold leading-[0.98] tracking-[-0.04em] text-star-bright md:text-7xl lg:text-8xl"
            style={{ animation: 'fadeIn 0.8s ease-out 0.1s both' }}
          >
            The AI Transformation
            <br />
            Galaxy
          </h1>
          <p
            className="mt-6 max-w-[52ch] text-base leading-relaxed text-star-bright/75 md:text-lg"
            style={{ animation: 'fadeIn 0.8s ease-out 0.25s both' }}
          >
            <strong className="font-semibold text-star-bright">
              {COMPANY_COUNT} Fortune 500 companies
            </strong>
            , each scored on five AI-maturity dimensions from public
            disclosures, mapped as an explorable 3D galaxy. Not a product. A
            research instrument.
          </p>
          <WebGLNotice />
          <div
            className="mt-10 flex flex-wrap items-center justify-center gap-3.5"
            style={{ animation: 'fadeIn 0.8s ease-out 0.4s both' }}
          >
            <Link
              href="/galaxy"
              prefetch={false}
              className="cta-primary rounded-lg bg-trajectory px-8 py-3.5 text-[15px] font-semibold text-white"
            >
              Enter the galaxy →
            </Link>
            <Link
              href="#methodology"
              prefetch={false}
              className="rounded-lg border border-border-subtle px-6 py-3.5 text-[14px] font-medium text-[var(--ui-dim)] transition-colors hover:border-trajectory hover:text-star-bright"
            >
              How scoring works
            </Link>
          </div>
        </div>
        <p
          className="absolute bottom-8 z-10 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--ui-muted)]"
          style={{ animation: 'fadeIn 1s ease-out 0.8s both' }}
        >
          Scroll to explore
        </p>
      </section>

      {/* ─── 01 — The Galaxy ─────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-28 md:py-36">
        <Reveal>
          <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
            01 / THE GALAXY
          </p>
          <h2 className="mt-4 text-4xl font-extrabold tracking-[-0.03em] text-star-bright md:text-5xl">
            Every star is a company.
          </h2>
          <p className="mt-5 max-w-[58ch] text-[15.5px] leading-relaxed text-star-bright/70">
            {COMPANY_COUNT} Fortune 500 enterprises mapped in 3D. Position
            encodes sector, color encodes AI maturity, size encodes evidence
            confidence. Fly through, zoom into a planet, and read the sourced
            profile behind every score.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <div className="mt-12">
            <div
              role="img"
              aria-label="Maturity scale from 0 to 100: orange low, amber mid, teal high"
              className="h-2.5 rounded-full bg-gradient-to-r from-maturity-low via-maturity-mid to-maturity-high"
            />
            <div className="mt-3 flex justify-between font-mono text-[11px] text-[var(--ui-muted)]">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
            <p className="mt-5 text-[13px] leading-relaxed text-[var(--ui-dim)]">
              <strong className="font-semibold text-maturity-low">Orange</strong> = early
              stage (0–40) ·{' '}
              <strong className="font-semibold text-maturity-mid">Amber</strong> = building
              (40–70) ·{' '}
              <strong className="font-semibold text-maturity-high">Teal</strong> = leading
              (70–100). Violet paths trace transformation trajectories between a
              company&apos;s past and current position.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ─── 02 — Methodology ────────────────────────────────────── */}
      <section
        id="methodology"
        className="mx-auto max-w-3xl scroll-mt-20 px-6 pb-28 md:pb-36"
      >
        <Reveal>
          <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
            02 / METHODOLOGY
          </p>
          <h2 className="mt-4 text-4xl font-extrabold tracking-[-0.03em] text-star-bright md:text-5xl">
            Five pillars, one number.
          </h2>
          <p className="mt-5 max-w-[58ch] text-[15.5px] leading-relaxed text-star-bright/70">
            Every star&apos;s color comes from a single overall maturity score:
            a weighted judgment of five dimensions, each derived from public
            evidence. Every bar in a planet profile links to the sources it was
            derived from.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <div className="mt-10">
            {DIMENSIONS.map((d, i) => (
              <div
                key={d.key}
                className="grid grid-cols-[48px_220px_1fr] items-baseline gap-4 border-b border-border-subtle/70 py-5 max-sm:grid-cols-[40px_1fr]"
              >
                <span className="font-mono text-[12px] text-trajectory">
                  D{i + 1}
                </span>
                <h3 className="text-[15px] font-bold text-star-bright max-sm:col-start-2">
                  {d.label}
                </h3>
                <p className="text-[13.5px] leading-relaxed text-[var(--ui-dim)] max-sm:col-start-2">
                  {d.description}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={140}>
          <div className="mt-10 rounded-xl border border-dashed border-maturity-mid/40 p-5 text-[12.5px] leading-relaxed text-[var(--ui-dim)]">
            <strong className="font-semibold text-maturity-mid">
              Independent estimates.
            </strong>{' '}
            Scores are derived by this project from public disclosures
            (filings, engineering blogs, job posts, talks). Companies named are
            not affiliated with, nor endorse, this project. Scores are analyst
            judgments, not company statements.{' '}
            <Link
              href="/methodology"
              prefetch={false}
              className="font-medium text-trajectory transition-colors hover:text-star-bright"
            >
              Full source list on the methodology page →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ─── 03 — Contact ────────────────────────────────────────── */}
      <section
        id="contact"
        className="mx-auto max-w-3xl scroll-mt-20 px-6 pb-28 md:pb-36"
      >
        <Reveal>
          <p className="font-mono text-[12px] tracking-[0.14em] text-trajectory">
            03 / GET IN TOUCH
          </p>
          <h2 className="mt-4 text-4xl font-extrabold tracking-[-0.03em] text-star-bright md:text-5xl">
            Ready to map your own
            <br />
            AI transformation?
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-10 md:grid-cols-2">
          <Reveal delay={60}>
            <p className="max-w-[48ch] text-[15px] leading-relaxed text-star-bright/70">
              Add your company to the galaxy and see the trajectory you could
              be on, or reach out to Primero for a full maturity assessment. We
              typically respond within one business day.
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-[var(--ui-dim)]">
              <span aria-hidden="true" className="text-maturity-high">
                ●
              </span>{' '}
              Your email client opens with the message pre-filled. The address
              stays off the page for crawlers.
            </p>
            <div className="mt-7">
              <Link
                href="/galaxy"
                prefetch={false}
                className="cta-primary inline-block rounded-lg bg-maturity-high px-7 py-3 text-[14px] font-semibold text-void"
              >
                Add your company to the galaxy
              </Link>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <ContactForm />
          </Reveal>
        </div>
      </section>

      {/* ─── Final CTA + footer ──────────────────────────────────── */}
      <section className="flex min-h-[45svh] flex-col items-center justify-center px-6 pb-16 text-center">
        <Reveal>
          <h2 className="text-lift mx-auto max-w-2xl text-3xl font-extrabold tracking-[-0.02em] text-star-bright md:text-4xl">
            Your company could be one of the stars.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[14px] leading-relaxed text-[var(--ui-dim)]">
            Fly in, look around, and add yourself to the map, or just lose
            yourself in {COMPANY_COUNT} stories of transformation.
          </p>
        </Reveal>
        <Link
          href="/galaxy"
          prefetch={false}
          className="cta-primary mt-8 inline-block rounded-lg bg-trajectory px-8 py-3.5 text-[15px] font-semibold text-white"
        >
          Enter the galaxy →
        </Link>
      </section>

      <footer className="border-t border-border-subtle/60 px-6 py-8">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 text-[11px] text-[var(--ui-muted)] sm:flex-row">
          <span className="font-semibold tracking-[0.18em] text-[var(--ui-dim)]">
            PRIMERO GALAXY
          </span>
          <span>
            {COMPANY_COUNT} companies &middot; 12 industries &middot; AI
            maturity estimates
          </span>
          <Link
            href="/galaxy"
            prefetch={false}
            className="inline-block py-2.5 transition-colors hover:text-star-bright"
          >
            Launch the galaxy ↗
          </Link>
        </div>
      </footer>
    </main>
  );
}
