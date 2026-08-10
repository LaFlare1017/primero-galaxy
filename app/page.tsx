import Link from 'next/link';
import type { Metadata } from 'next';
import { ContactForm } from '@/components/ui/ContactForm';

export const metadata: Metadata = {
  title: 'Primero Galaxy — An Explorable AI Transformation Galaxy',
  description:
    'Every star is a company. Every constellation is a transformation strategy. Every trajectory is a path to AI maturity. Explore 500 companies in 3D.',
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
 * Legend dot: a hollow glowing "star bubble" that breathes like the animated
 * stars in the galaxy tool. The rim/bloom colors arrive as CSS custom
 * properties so each maturity band keeps its red → amber → teal story.
 */
function LegendBubble({
  color,
  glow,
  delay = 0,
}: {
  color: string;
  glow: string;
  delay?: number;
}) {
  return (
    <span
      className="legend-bubble shrink-0"
      style={
        {
          '--bubble': color,
          '--bubble-glow': glow,
          animationDelay: `${delay}s`,
        } as React.CSSProperties
      }
    />
  );
}

export default function LandingPage() {
  return (
    <main className="h-screen overflow-y-auto">
      {/* ---------------------------------------------------------------- Nav */}
      <header className="fixed inset-x-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border-subtle/60 bg-void/70 px-6 backdrop-blur-md">
        <span className="text-[13px] font-semibold tracking-[0.18em] text-star-bright">
          PRIMERO GALAXY
        </span>
        <nav aria-label="Primary">
          <Link
            href="/galaxy" prefetch={false}
            className="rounded-md border border-maturity-high/50 px-3 py-1.5 text-[12px] font-medium text-maturity-high transition-colors hover:bg-maturity-high/10"
          >
            Enter the galaxy →
          </Link>
        </nav>
      </header>

      {/* --------------------------------------------------------------- Hero */}
      <section className="flex min-h-screen flex-col items-center justify-center px-6 pb-24 text-center">
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
          500 companies. One universe. Explore.
        </p>
        <p
          className="mt-6 max-w-xl text-[15px] leading-relaxed text-ui-dim"
          style={fade(0.4)}
        >
          A living 3D map of how companies become AI-native. Every star is a
          company, its color its AI maturity. Zoom in and every star becomes a
          planet you can orbit, inspect, and transform.
        </p>
        <div
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
          style={fade(0.55)}
        >
          <Link
            href="/galaxy" prefetch={false}
            className="rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void transition-opacity hover:opacity-90"
          >
            Enter the galaxy
          </Link>
          <a
            href="#how"
            className="rounded-md border border-border-subtle px-6 py-3 text-sm font-medium text-ui-dim transition-colors hover:border-star-dim hover:text-star-bright"
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
            and every one of them tells the story of a company&apos;s AI
            transformation. The closer you look, the more the data reveals
            itself.
          </p>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-6">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-void text-lg"
              >
                ⭐
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                A star is a company
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ui-muted">
                500 companies across 7 industries — Manufacturing, Healthcare,
                SaaS, Fintech, Logistics, Retail, and Energy — each with its
                own ERP, size, and maturity profile.
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle bg-nebula/40 p-6">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-void text-lg"
              >
                🎨
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
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-void text-lg"
              >
                ✦
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
              <LegendBubble color="#FF6B35" glow="rgba(255,107,53,0.5)" />
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
              <LegendBubble color="#F7C548" glow="rgba(247,197,72,0.5)" delay={-1.2} />
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
              <LegendBubble color="#00D9C0" glow="rgba(0,217,192,0.5)" delay={-2.4} />
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
            <span className="h-0.5 w-8 shrink-0 rounded-full bg-trajectory" />
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
            {[
              ['Drag', 'to orbit the galaxy'],
              ['Scroll', 'to zoom from galaxy to constellation to planet'],
              ['Double-click a star', 'to fly in and open its full profile'],
              ['Esc', 'to return to the galaxy'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border-subtle bg-void/60 p-5">
                <h3 className="text-[13px] font-semibold text-star-bright">{k}</h3>
                <div className="mt-1 text-[12px] leading-relaxed text-ui-muted">{v}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-xl border border-border-subtle bg-nebula/40 p-6">
            <div className="text-[12px] font-semibold uppercase tracking-label text-ui-dim">
              Three levels of detail
            </div>
            <div className="mt-4 grid gap-6 md:grid-cols-3">
              {[
                [
                  'Galaxy',
                  '500 stars in pure space. Color and size tell the maturity story at a glance.',
                ],
                [
                  'Constellation',
                  'Zoom in and names appear. Faint lines connect related companies across the sky.',
                ],
                [
                  'Planet',
                  'Inspect one company — a radar chart of five maturity dimensions, its trajectory, and projected ROI.',
                ],
              ].map(([t, d]) => (
                <div key={t}>
                  <h3 className="text-[14px] font-semibold text-maturity-high">{t}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ui-muted">{d}</p>
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
                A three-field form places your company as a star in the galaxy,
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
              className="rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void transition-opacity hover:opacity-90"
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
          yourself in 500 stories of transformation.
        </p>
        <Link
          href="/galaxy" prefetch={false}
          className="mt-8 inline-block rounded-md bg-maturity-high px-8 py-3.5 text-sm font-semibold text-void transition-opacity hover:opacity-90"
        >
          Enter the galaxy
        </Link>
      </section>

      <footer className="border-t border-border-subtle/60 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-[11px] text-ui-muted sm:flex-row">
          <span className="font-semibold tracking-[0.18em] text-ui-dim">PRIMERO GALAXY</span>
          <span>500 companies · 7 industries · 7 ERP systems</span>
          <Link href="/galaxy" prefetch={false} className="transition-colors hover:text-star-bright">
            Launch the galaxy ↗
          </Link>
        </div>
      </footer>
    </main>
  );
}
