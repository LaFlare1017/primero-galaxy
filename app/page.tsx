import Link from 'next/link';
import type { Metadata } from 'next';
import { ContactForm } from '@/components/ui/ContactForm';
import { breathTiming } from '@/lib/constants';
import { COMPANY_COUNT } from '@/lib/fortune500-data';

export const metadata: Metadata = {
  title: 'Primero Galaxy — An Explorable AI Transformation Galaxy',
  description:
    'Every star is a Fortune 500 enterprise. Every constellation is a transformation strategy. Every trajectory is a path to AI maturity. Explore real companies in 3D.',
  alternates: { canonical: '/' },
};

/** Staggered fade-in helper: keyframes come from Tailwind (animate-fade-in). */
const fade = (delay: number): React.CSSProperties => ({
  animation: 'fadeIn 0.8s ease-out both',
  animationDelay: `${delay}s`,
});

const EYEBROW = 'text-[11px] font-semibold uppercase tracking-label text-trajectory';
const SECTION_TITLE = 'text-3xl font-semibold tracking-title text-star-bright md:text-4xl';

/**
 * Trajectory indicator line: pulses its violet glow on the same halo wave as
 * the legend bubbles (star 3 of the shared breathing family), glow-only so
 * the line keeps its shape.
 */
function TrajectoryLine() {
  const { duration, delay } = breathTiming(3);
  return (
    <span
      className="trajectory-breathe h-0.5 w-8 shrink-0 rounded-full bg-trajectory"
      style={
        {
          '--trajectory-glow': 'rgba(123,97,255,0.5)',
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
        } as React.CSSProperties
      }
    />
  );
}

/**
 * Legend dot: a hollow glowing "star bubble" that breathes on the exact wave
 * of the star it stands for — the halo breathing of galaxy star `starIndex`
 * (frequency and phase from the shared starBreath constants). The rim/bloom
 * colors arrive as CSS custom properties so each maturity band keeps its
 * red → amber → teal story.
 */
function LegendBubble({
  starIndex,
  color,
  glow,
}: {
  starIndex: number;
  color: string;
  glow: string;
}) {
  // Same sine wave as the galaxy: scale = 1 + amplitude·sin(ωt + phase).
  // animationDelay is negative so the bubble is mid-cycle at first paint,
  // exactly like an already-animating star.
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

export default function LandingPage() {
  return (
    <main className="h-[100dvh] overflow-y-auto">
      {/* ---------------------------------------------------------------- Nav */}
      <header className="fixed inset-x-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border-subtle/60 bg-void/70 px-6 backdrop-blur-md">
        <span className="text-[13px] font-semibold tracking-[0.18em] text-star-bright">
          PRIMERO GALAXY
        </span>
        <nav aria-label="Primary">
          <Link
            href="/galaxy" prefetch={false}
            className="rounded-md border border-maturity-high/50 px-3 py-1.5 text-[12px] font-medium text-maturity-high transition hover:bg-maturity-high/10 active:scale-[0.98]"
          >
            Enter the galaxy →
          </Link>
        </nav>
      </header>

      {/* --------------------------------------------------------------- Hero */}
      <section className="flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-24 text-center">
        <p className={EYEBROW} style={fade(0)}>
          AI Transformation Maturity
        </p>
        <h1
          className="mt-5 max-w-4xl animate-fade-in text-5xl font-semibold tracking-title text-star-bright md:text-[72px] md:leading-[1.05]"
          style={fade(0.1)}
        >
          The AI Transformation Galaxy
        </h1>
        <p
          className="mt-6 text-xs uppercase tracking-label text-ui-muted md:text-sm"
          style={fade(0.25)}
        >
          {COMPANY_COUNT} Fortune 500 companies. One universe. Explore.
        </p>
        <p
          className="mt-6 max-w-xl text-[15px] leading-relaxed text-ui-dim"
          style={fade(0.4)}
        >
          A living 3D map of how America&apos;s largest enterprises are becoming
          AI-native. Every star is a company, its color its estimated AI
          maturity. Zoom in and every star becomes a planet you can orbit,
          inspect, and transform.
        </p>
        <div
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
          style={fade(0.55)}
        >
          <Link
            href="/galaxy" prefetch={false}
            className="rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void transition hover:opacity-90 active:scale-[0.98]"
          >
            Enter the galaxy
          </Link>
          <a
            href="#how"
            className="rounded-md border border-border-subtle px-6 py-3 text-sm font-medium text-ui-dim transition hover:border-star-dim hover:text-star-bright active:scale-[0.98]"
          >
            How to read it
          </a>
        </div>
        <p
          className="absolute bottom-8 animate-pulse-slow text-[11px] uppercase tracking-label text-ui-muted"
          style={fade(0.8)}
        >
          Scroll to explore
        </p>
      </section>

      {/* ------------------------------------------------------ What it is */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className={EYEBROW}>What it is</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>
            The galaxy <span className="text-ui-muted">is</span> the interface.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ui-dim">
            No dashboards, no sidebars, no panels. Every star earns its place —
            and every one of them tells the story of a Fortune 500 company&apos;s
            AI transformation, estimated from what it has publicly said and
            shipped. The closer you look, the more the data reveals itself.
          </p>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-6">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-void"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3.5 L14 10 L20.5 12 L14 14 L12 20.5 L10 14 L3.5 12 L10 10 Z" />
                </svg>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                A star is a Fortune 500 company
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                {COMPANY_COUNT} real enterprises across 12 industries —
                Technology, Financial Services, Healthcare, Retail, Energy and
                more — each with an estimated AI maturity profile compiled
                from public disclosures.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-6">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-void"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <circle cx="7" cy="16" r="3.5" fill="#FF6B35" />
                  <circle cx="12" cy="18.5" r="3.5" fill="#F7C548" />
                  <circle cx="16.5" cy="12" r="3.5" fill="#00D9C0" />
                </svg>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                Color is maturity
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                Warm orange means early stage. Amber is mid-transformation.
                Teal signals a company that has arrived. Size scales with
                maturity too — the leaders are the biggest stars.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-6">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-void"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="#7B61FF"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M4 17.5 C 10 17.5, 12 6.5, 20 6.5" />
                  <circle cx="20" cy="6.5" r="1.6" fill="#7B61FF" stroke="none" />
                </svg>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                Trajectories are transformation
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                Violet paths arc from every company to its projected future —
                with EBITDA impact, exit multiple, and milestone-by-milestone
                plans.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Color legend */}
      <section id="how" className="border-y border-border-subtle/60 bg-nebula/30 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className={EYEBROW}>How to read it</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>One glance, one story.</h2>

          <div className="mt-10 grid gap-3 md:grid-cols-3">
            <div className="flex items-center gap-4 rounded-xl border border-border-subtle bg-void/60 p-5">
              <LegendBubble starIndex={0} color="#FF6B35" glow="rgba(255,107,53,0.5)" />
              <div>
                <h3 className="text-[13px] font-medium text-star-bright">
                  Low maturity · 0–40
                </h3>
                <div className="mt-0.5 text-[12px] text-ui-muted">
                  Early AI adoption — data scattered, workflows manual.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-xl border border-border-subtle bg-void/60 p-5">
              <LegendBubble starIndex={1} color="#F7C548" glow="rgba(247,197,72,0.5)" />
              <div>
                <h3 className="text-[13px] font-medium text-star-bright">
                  Mid maturity · 40–70
                </h3>
                <div className="mt-0.5 text-[12px] text-ui-muted">
                  Standardizing workflows, first AI use cases in production.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-xl border border-border-subtle bg-void/60 p-5">
              <LegendBubble starIndex={2} color="#00D9C0" glow="rgba(0,217,192,0.5)" />
              <div>
                <h3 className="text-[13px] font-medium text-star-bright">
                  High maturity · 70–100
                </h3>
                <div className="mt-0.5 text-[12px] text-ui-muted">
                  Scaled AI deployment, governance in place, agents at work.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4 rounded-xl border border-trajectory/30 bg-trajectory/5 p-5">
            <TrajectoryLine />
            <div>
              <h3 className="text-[13px] font-medium text-trajectory">
                Violet paths are trajectories
              </h3>
              <div className="mt-0.5 text-[12px] text-ui-muted">
                The projected route from where a company is to where it could
                be — complete with milestones and ROI.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Navigation */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className={EYEBROW}>Explore</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>Fly like a spacecraft.</h2>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* The four spacecraft controls carry the same hollow breathing
                bubbles (stars 7–10 of the shared family), completing the
                page-wide indicator system. Esc uses the trajectory violet as
                a nod to returning along the path. */}
            {[
              {
                title: 'Drag',
                body: 'to orbit the galaxy',
                color: '#FF6B35',
                glow: 'rgba(255,107,53,0.5)',
                starIndex: 7,
              },
              {
                title: 'Scroll',
                body: 'to zoom from galaxy to constellation to planet',
                color: '#F7C548',
                glow: 'rgba(247,197,72,0.5)',
                starIndex: 8,
              },
              {
                title: 'Double-click a star',
                body: 'to fly in and open its full profile',
                color: '#00D9C0',
                glow: 'rgba(0,217,192,0.5)',
                starIndex: 9,
              },
              {
                title: 'Esc',
                body: 'to return to the galaxy',
                color: '#7B61FF',
                glow: 'rgba(123,97,255,0.5)',
                starIndex: 10,
              },
            ].map(({ title, body, color, glow, starIndex }) => (
              <div
                key={title}
                className="rounded-xl border border-border-subtle bg-void/60 p-5"
              >
                <div className="flex items-start gap-3">
                  <LegendBubble starIndex={starIndex} color={color} glow={glow} />
                  <div>
                    <h3 className="text-[13px] font-semibold text-star-bright">{title}</h3>
                    <div className="mt-1 text-[12px] leading-relaxed text-ui-muted">{body}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-xl border border-border-subtle bg-nebula/40 p-6">
            <div className="text-[12px] font-semibold uppercase tracking-label text-ui-dim">
              Three levels of detail
            </div>
            <div className="mt-4 grid gap-6 md:grid-cols-3">
              {/* Zoom levels carry the same hollow breathing bubbles as the
                  legend (stars 4–6 of the shared breathing family), so the
                  whole page undulates on one wave. The color ladder mirrors
                  the legend: orange → amber → teal as you zoom in. */}
              {[
                {
                  title: 'Galaxy',
                  body: `${COMPANY_COUNT} stars in pure space. Color and size tell the maturity story at a glance.`,
                  color: '#FF6B35',
                  glow: 'rgba(255,107,53,0.5)',
                  starIndex: 4,
                },
                {
                  title: 'Constellation',
                  body: 'Zoom in and names appear. Faint lines connect related companies across the sky.',
                  color: '#F7C548',
                  glow: 'rgba(247,197,72,0.5)',
                  starIndex: 5,
                },
                {
                  title: 'Planet',
                  body: 'Inspect one company — a radar chart of five maturity dimensions, its trajectory, and projected ROI.',
                  color: '#00D9C0',
                  glow: 'rgba(0,217,192,0.5)',
                  starIndex: 6,
                },
              ].map(({ title, body, color, glow, starIndex }) => (
                <div key={title} className="flex items-start gap-3">
                  <LegendBubble starIndex={starIndex} color={color} glow={glow} />
                  <div>
                    <h3 className="text-[14px] font-semibold text-maturity-high">{title}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ui-muted">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Features */}
      <section className="border-t border-border-subtle/60 bg-nebula/30 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <p className={EYEBROW}>Beyond looking</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>Put yourself in it.</h2>

          <div className="mt-10 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border-subtle bg-void/60 p-6">
              <h3 className="text-[15px] font-semibold text-star-bright">
                Add your company
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                A two-field form places your company as a star in the galaxy,
                saves it to your browser, and shows you the trajectory you
                could be on.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-void/60 p-6">
              <h3 className="text-[15px] font-semibold text-star-bright">
                Planet-view deep dives
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                Every star opens into a full profile: data infrastructure,
                workflow standardization, AI deployment, governance, and
                talent — each scored 0–100.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-void/60 p-6">
              <h3 className="text-[15px] font-semibold text-star-bright">
                Transformation trajectories
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                Projected EBITDA impact, exit-multiple improvement, and
                milestone-by-milestone plans drawn in 3D space.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-void/60 p-6 opacity-85">
              <h3 className="text-[15px] font-semibold text-star-bright">
                PE portfolio mode
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                Coming soon — select 3–7 portfolio companies and watch
                standardize → cluster → deploy play out across the galaxy.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Contact */}
      <section
        id="contact"
        className="border-t border-border-subtle/60 bg-nebula/30 px-6 py-24"
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className={EYEBROW}>Get in touch</p>
          <h2 className={`${SECTION_TITLE} mt-3`}>
            Ready to map your own AI transformation?
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[14px] leading-relaxed text-ui-dim">
            Add your company to the galaxy and see the trajectory you could
            be on — or reach out to Primero for a full maturity assessment.
          </p>
          <div className="mt-8 flex flex-col items-center gap-6">
            <Link
              href="/galaxy" prefetch={false}
              className="rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void transition hover:opacity-90 active:scale-[0.98]"
            >
              Add your company to the galaxy
            </Link>
            <div className="w-full max-w-xl">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Final CTA */}
      <section className="px-6 py-32 text-center">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-title text-star-bright md:text-4xl">
          Your company could be one of the stars.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-[14px] leading-relaxed text-ui-dim">
          Fly in, look around, and add yourself to the map — or just lose
          yourself in {COMPANY_COUNT} stories of transformation.
        </p>
        <Link
          href="/galaxy" prefetch={false}
          className="mt-8 inline-block rounded-md bg-maturity-high px-8 py-3.5 text-sm font-semibold text-void transition hover:opacity-90 active:scale-[0.98]"
        >
          Enter the galaxy
        </Link>
      </section>

      <footer className="border-t border-border-subtle/60 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-[11px] text-ui-muted sm:flex-row">
          <span className="font-semibold tracking-[0.18em] text-ui-dim">PRIMERO GALAXY</span>
          <span>
            {COMPANY_COUNT} companies · 12 industries · AI maturity estimates
          </span>
          <Link href="/galaxy" prefetch={false} className="transition-colors hover:text-star-bright">
            Launch the galaxy ↗
          </Link>
        </div>
      </footer>
    </main>
  );
}
