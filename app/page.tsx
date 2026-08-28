import Link from 'next/link';
import type { Metadata } from 'next';
import { ContactForm } from '@/components/ui/ContactForm';
import InteractiveLines from '@/components/ui/InteractiveLines';
import { Reveal } from '@/components/ui/Reveal';
import { WebGLNotice } from '@/components/ui/WebGLNotice';
import { breathTiming, DIMENSIONS } from '@/lib/constants';
import { COMPANY_COUNT } from '@/lib/fortune500-data';

export const metadata: Metadata = {
  title: 'Primero Galaxy: An Explorable AI Transformation Galaxy',
  description:
    'Every star is a Fortune 500 enterprise. Every constellation is a transformation strategy. Every trajectory is a path to AI maturity. Explore real companies in 3D.',
  alternates: { canonical: '/' },
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

const fade = (delay: number): React.CSSProperties => ({
  animation: 'fadeIn 0.8s ease-out both',
  animationDelay: `${delay}s`,
});

/* ── breathing components (same wave as galaxy stars) ────────────────────── */

function LegendBubble({
  starIndex,
  color,
  glow,
}: {
  starIndex: number;
  color: string;
  glow: string;
}) {
  const { duration, delay } = breathTiming(starIndex);
  return (
    <span
      className="legend-bubble shrink-0"
      style={
        {
          '--bubble': color,
          '--bubble-glow': glow,
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
        } as React.CSSProperties
      }
    />
  );
}

/* ── Stat row (Event Horizon style) ─────────────────────────────────────── */

function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-[12px]">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-2">
          <span className="font-medium text-[var(--ui-muted)]">{item.label}</span>
          <span className="text-star-bright/80">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="h-[100dvh] overflow-y-auto">
      {/* Fixed reactive-lines background */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
        <InteractiveLines
          backgroundColor="#030308"
          lineColor="#ABABC7"
          lineWidth={0.5}
          minLines={108}
          maxLines={15}
        />
      </div>

      {/* Ambient light washes */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -right-[12%] -top-[18%] h-[70vh] w-[55vw] rounded-full bg-trajectory/10 blur-[140px]" />
        <div className="absolute -bottom-[22%] -left-[12%] h-[62vh] w-[50vw] rounded-full bg-maturity-high/10 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_65%_at_50%_40%,transparent_48%,rgba(3,3,8,0.45)_100%)]" />
      </div>

      {/* Page content */}
      <div className="relative z-10">
        {/* ─── Nav ─────────────────────────────────────────────────── */}
        <header className="fixed inset-x-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border-subtle/60 bg-void/70 px-6 backdrop-blur-md">
          <span className="text-[13px] font-semibold tracking-[0.18em] text-star-bright max-[560px]:text-[11px]">
            PRIMERO GALAXY
          </span>
          <nav aria-label="Primary">
            <Link
              href="/galaxy"
              prefetch={false}
              className="rounded-md border border-maturity-high/50 px-4 py-3 text-[12px] font-medium text-maturity-high transition hover:bg-maturity-high/10 active:scale-[0.98]"
            >
              Enter the galaxy →
            </Link>
          </nav>
        </header>

        {/* ─── 00 — Hero ──────────────────────────────────────────── */}
        <section className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_70%_at_50%_50%,rgba(3,3,8,0.92),rgba(3,3,8,0.45)_48%,transparent_78%)]"
          />
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ui-muted)]"
            style={fade(0)}
          >
            Fortune 500 · 12 industries · AI maturity estimates
          </p>
          <h1
            className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.05] tracking-[-0.03em] text-star-bright md:text-7xl lg:text-8xl"
            style={fade(0.1)}
          >
            The AI Transformation
            <br />
            Galaxy
          </h1>
          <p
            className="mt-6 max-w-[48ch] text-base leading-relaxed text-star-bright/80 md:text-lg"
            style={fade(0.25)}
          >
            Each star is a Fortune 500 company embarking on an AI
            Transformation journey. Explore.
          </p>
          <WebGLNotice />
          <div className="mt-12" style={fade(0.5)}>
            <Link
              href="/galaxy"
              prefetch={false}
              className="cta-primary rounded-md bg-maturity-high px-8 py-3.5 text-sm font-semibold text-void active:scale-[0.98]"
            >
              Enter the galaxy
            </Link>
          </div>
          <p
            className="absolute bottom-10 animate-pulse-slow text-[11px] uppercase tracking-[0.12em] text-[var(--ui-muted)]"
            style={fade(0.8)}
          >
            Scroll to fall
          </p>
        </section>

        {/* ─── 01 — The Galaxy ─────────────────────────────────────── */}
        <section className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
          <Reveal>
            <span className="font-mono text-[13px] tracking-[0.1em] text-[var(--ui-muted)]">
              01
            </span>
          </Reveal>
          <Reveal delay={40}>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-star-bright md:text-5xl lg:text-6xl">
              The galaxy is the
              <br />
              interface.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-star-bright/70">
              No dashboards, no sidebars, no panels. Every star earns its
              place, and every one of them tells the story of a Fortune 500
              company&apos;s AI transformation, estimated from what it has
              publicly said and shipped.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-8">
              <StatRow
                items={[
                  { label: 'Companies', value: `${COMPANY_COUNT}` },
                  { label: 'Industries', value: '12' },
                  { label: 'Dimensions', value: '5' },
                ]}
              />
            </div>
          </Reveal>
        </section>

        {/* ─── 02 — How to Read It ─────────────────────────────────── */}
        <section className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
          <Reveal>
            <span className="font-mono text-[13px] tracking-[0.1em] text-[var(--ui-muted)]">
              02
            </span>
          </Reveal>
          <Reveal delay={40}>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-star-bright md:text-5xl lg:text-6xl">
              One glance,
              <br />
              one story.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-star-bright/70">
              Color marks maturity. Size scales with confidence. Violet paths
              trace transformation. The galaxy speaks in light, not legends.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-10 flex flex-col items-center gap-4">
              <div className="flex items-center gap-6">
                <LegendBubble
                  starIndex={0}
                  color="#FF6B35"
                  glow="rgba(255,107,53,0.5)"
                />
                <LegendBubble
                  starIndex={1}
                  color="#F7C548"
                  glow="rgba(247,197,72,0.5)"
                />
                <LegendBubble
                  starIndex={2}
                  color="#00D9C0"
                  glow="rgba(0,217,192,0.5)"
                />
              </div>
              <StatRow
                items={[
                  { label: 'Low', value: '0–40' },
                  { label: 'Mid', value: '40–70' },
                  { label: 'High', value: '70–100' },
                ]}
              />
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="mt-8">
              <StatRow
                items={[
                  { label: 'Trajectories', value: 'Violet paths' },
                  { label: 'Evidence', value: 'Linked per score' },
                  { label: 'Benchmark', value: 'Sector median' },
                ]}
              />
            </div>
          </Reveal>
        </section>

        {/* ─── 03 — How to Use It ──────────────────────────────────── */}
        <section className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
          <Reveal>
            <span className="font-mono text-[13px] tracking-[0.1em] text-[var(--ui-muted)]">
              03
            </span>
          </Reveal>
          <Reveal delay={40}>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-star-bright md:text-5xl lg:text-6xl">
              Put yourself
              <br />
              in it.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-star-bright/70">
              Add your company as a star, fly to any planet, trace
              transformation trajectories, or search by name. The galaxy
              rewards curiosity.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-8">
              <StatRow
                items={[
                  { label: 'Add', value: '2 fields' },
                  { label: 'View', value: '5 scores' },
                  { label: 'Trajectory', value: '3D path' },
                  { label: 'Search', value: 'By name' },
                ]}
              />
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="mt-10">
              <Link
                href="/galaxy"
                prefetch={false}
                className="cta-primary rounded-md bg-maturity-high px-8 py-3.5 text-sm font-semibold text-void active:scale-[0.98]"
              >
                Enter the galaxy
              </Link>
            </div>
          </Reveal>
        </section>

        {/* ─── 04 — The Methodology ────────────────────────────────── */}
        <section
          id="methodology"
          className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center"
        >
          <Reveal>
            <span className="font-mono text-[13px] tracking-[0.1em] text-[var(--ui-muted)]">
              04
            </span>
          </Reveal>
          <Reveal delay={40}>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-star-bright md:text-5xl lg:text-6xl">
              Five pillars,
              <br />
              one number.
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-[48ch] text-[15px] leading-relaxed text-star-bright/70">
              Every star&apos;s color comes from a single overall maturity
              score, a weighted judgment of five dimensions. Each bar in the
              planet profile links to the public evidence it was derived from.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-10 grid max-w-2xl gap-4 text-left sm:grid-cols-2">
              {DIMENSIONS.map((d, i) => (
                <div key={d.key} className="flex gap-3">
                  <span className="shrink-0 pt-0.5 font-mono text-[11px] tracking-[0.1em] text-[var(--ui-muted)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h4 className="text-[13px] font-semibold text-star-bright">
                      {d.label}
                    </h4>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--ui-dim)]">
                      {d.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="mt-8">
              <StatRow
                items={[
                  { label: 'Sources', value: 'Public disclosures' },
                  { label: 'Weighting', value: 'Analyst judgment' },
                  { label: 'Benchmark', value: 'Sector median' },
                ]}
              />
            </div>
          </Reveal>
          <Reveal delay={200}>
            <div className="mt-6">
              <Link
                href="/methodology"
                prefetch={false}
                className="text-[12px] font-medium text-trajectory transition hover:text-star-bright"
              >
                Read the full methodology and research trail →
              </Link>
            </div>
          </Reveal>
        </section>

        {/* ─── 05 — Contact ────────────────────────────────────────── */}
        <section
          id="contact"
          className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center"
        >
          <Reveal>
            <span className="font-mono text-[13px] tracking-[0.1em] text-[var(--ui-muted)]">
              05
            </span>
          </Reveal>
          <Reveal delay={40}>
            <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.02em] text-star-bright md:text-5xl lg:text-6xl">
              Ready to map your own
              <br />
              AI transformation?
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-6 max-w-[44ch] text-[15px] leading-relaxed text-star-bright/70">
              Add your company to the galaxy and see the trajectory you could
              be on, or reach out to Primero for a full maturity assessment.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-8 flex flex-col items-center gap-6">
              <Link
                href="/galaxy"
                prefetch={false}
                className="cta-primary rounded-md bg-maturity-high px-8 py-3.5 text-sm font-semibold text-void active:scale-[0.98]"
              >
                Add your company to the galaxy
              </Link>
              <div className="w-full max-w-xl">
                <ContactForm />
              </div>
            </div>
          </Reveal>
        </section>

        {/* ─── Final CTA ───────────────────────────────────────────── */}
        <section className="flex min-h-[60dvh] flex-col items-center justify-center px-6 text-center">
          <Reveal>
            <div
              aria-hidden="true"
              className="mb-8 flex items-center justify-center gap-3"
            >
              <LegendBubble
                starIndex={0}
                color="#FF6B35"
                glow="rgba(255,107,53,0.5)"
              />
              <LegendBubble
                starIndex={1}
                color="#F7C548"
                glow="rgba(247,197,72,0.5)"
              />
              <LegendBubble
                starIndex={2}
                color="#00D9C0"
                glow="rgba(0,217,192,0.5)"
              />
            </div>
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.02em] text-star-bright md:text-4xl">
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
            className="cta-primary mt-8 inline-block rounded-md bg-maturity-high px-8 py-3.5 text-sm font-semibold text-void"
          >
            Enter the galaxy
          </Link>
        </section>

        {/* ─── Footer ──────────────────────────────────────────────── */}
        <footer className="border-t border-border-subtle/60 px-6 py-8">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-[11px] text-[var(--ui-muted)] sm:flex-row">
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
      </div>
    </main>
  );
}
