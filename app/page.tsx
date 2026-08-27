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

const EYEBROW =
  'text-[11px] font-semibold uppercase tracking-[0.05em] text-trajectory';
const HEADING =
  'text-3xl font-semibold tracking-[-0.02em] text-star-bright md:text-4xl';

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

function BreathingIcon({
  starIndex,
  children,
}: {
  starIndex: number;
  children: React.ReactNode;
}) {
  const { duration, delay } = breathTiming(starIndex);
  return (
    <div
      aria-hidden="true"
      className="chip-breathe flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-void"
      style={
        {
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
        } as React.CSSProperties
      }
    >
      {children}
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

        {/* ─── Hero ────────────────────────────────────────────────── */}
        <section className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 pb-24 text-center md:items-start md:px-[8vw] md:text-left">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_90%_70%_at_35%_50%,rgba(3,3,8,0.92),rgba(3,3,8,0.45)_48%,transparent_78%)]"
          />
          <p className={EYEBROW} style={fade(0)}>
            AI Transformation Maturity Visualization
          </p>
          <h1
            className="mt-5 max-w-4xl text-lift text-4xl font-semibold leading-[1.05] tracking-[-0.02em] text-star-bright md:text-6xl"
            style={fade(0.1)}
          >
            The AI Transformation Galaxy
          </h1>
          <p
            className="mt-5 max-w-[62ch] text-base leading-relaxed text-star-bright/90 md:text-lg"
            style={fade(0.25)}
          >
            Each star is a Fortune 500 company embarking on an AI
            Transformation journey. Explore.
          </p>
          <p
            className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-[var(--ui-dim)]"
            style={fade(0.4)}
          >
            A living 3D map of America&apos;s largest enterprises becoming
            AI-native. Color marks each company&apos;s estimated maturity; zoom
            in and any star becomes a planet you can orbit, inspect, and
            transform.
          </p>
          <div
            className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
            style={fade(0.55)}
          >
            <Link
              href="/galaxy"
              prefetch={false}
              className="cta-primary rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void active:scale-[0.98]"
            >
              Enter the galaxy
            </Link>
            <a
              href="#methodology"
              className="rounded-md border border-border-subtle px-6 py-3 text-sm font-medium text-[var(--ui-dim)] transition hover:border-star-dim hover:text-star-bright active:scale-[0.98]"
            >
              How it works
            </a>
          </div>
          <WebGLNotice />
          <p
            className="absolute bottom-8 animate-pulse-slow text-[11px] uppercase tracking-[0.05em] text-[var(--ui-muted)]"
            style={fade(0.8)}
          >
            Scroll to explore
          </p>
        </section>

        {/* ─── 01 — What is the Galaxy ─────────────────────────────── */}
        <section className="px-6 py-24 md:py-32">
          <div className="mx-auto grid max-w-6xl items-start gap-12 md:grid-cols-12 md:gap-10">
            {/* Sticky heading column */}
            <div className="md:sticky md:top-24 md:col-span-5">
              <Reveal>
                <p className={EYEBROW}>
                  <span className="mr-3 font-mono tracking-[0.1em] text-[var(--ui-muted)]">
                    01
                  </span>
                  What it is
                </p>
                <h2 className={`${HEADING} mt-3`}>
                  The galaxy{' '}
                  <span className="text-[var(--ui-muted)]">is</span> the
                  interface.
                </h2>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--ui-dim)]">
                  No dashboards, no sidebars, no panels. Every star earns its
                  place, and every one of them tells the story of a Fortune 500
                  company&apos;s AI transformation, estimated from what it has
                  publicly said and shipped.
                </p>
              </Reveal>
            </div>

            {/* Content cards — asymmetric grid */}
            <div className="md:col-span-7">
              <div className="grid gap-4 md:grid-cols-12">
                <Reveal delay={60} className="h-full md:col-span-7">
                  <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-[var(--nebula)]/40 p-6 hover-card">
                    <BreathingIcon starIndex={11}>
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
                    </BreathingIcon>
                    <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                      A star is a Fortune 500 company
                    </h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                      {COMPANY_COUNT} real enterprises across 12 industries:
                      Technology, Financial Services, Healthcare, Retail,
                      Energy, and more, each with an estimated AI maturity
                      profile compiled from public disclosures.
                    </p>
                  </div>
                </Reveal>
                <Reveal delay={120} className="h-full md:col-span-5">
                  <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-[var(--nebula)]/40 p-6 hover-card">
                    <BreathingIcon starIndex={12}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5">
                        <circle cx="7" cy="16" r="3.5" fill="#FF6B35" />
                        <circle cx="12" cy="18.5" r="3.5" fill="#F7C548" />
                        <circle cx="16.5" cy="12" r="3.5" fill="#00D9C0" />
                      </svg>
                    </BreathingIcon>
                    <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                      Color is maturity
                    </h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                      Warm orange means early stage. Amber is
                      mid-transformation. Teal signals a company that has
                      arrived. Size scales with maturity too.
                    </p>
                  </div>
                </Reveal>
                <Reveal delay={180} className="h-full md:col-span-7 md:col-start-6">
                  <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-[var(--nebula)]/40 p-6 hover-card">
                    <BreathingIcon starIndex={13}>
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
                    </BreathingIcon>
                    <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                      Trajectories are transformation
                    </h3>
                    <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                      Violet paths arc from every company to its projected
                      future, with EBITDA impact, exit multiple, and
                      milestone-by-milestone plans.
                    </p>
                  </div>
                </Reveal>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 02 — How to read it ─────────────────────────────────── */}
        <section className="border-y border-border-subtle/60 bg-[var(--nebula)]/40 px-6 py-24">
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <p className={EYEBROW}>
                <span className="mr-3 font-mono tracking-[0.1em] text-[var(--ui-muted)]">
                  02
                </span>
                How to read it
              </p>
              <h2 className={`${HEADING} mt-3`}>One glance, one story.</h2>
            </Reveal>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              <Reveal delay={60} className="h-full">
                <div className="flex h-full items-center gap-4 rounded-xl border border-border-subtle bg-void/60 p-5 hover-card">
                  <LegendBubble
                    starIndex={0}
                    color="#FF6B35"
                    glow="rgba(255,107,53,0.5)"
                  />
                  <div>
                    <h3 className="text-[13px] font-medium text-star-bright">
                      Low maturity &middot; 0&ndash;40
                    </h3>
                    <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                      Early AI adoption: data scattered, workflows manual.
                    </p>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={120} className="h-full">
                <div className="flex h-full items-center gap-4 rounded-xl border border-border-subtle bg-void/60 p-5 hover-card">
                  <LegendBubble
                    starIndex={1}
                    color="#F7C548"
                    glow="rgba(247,197,72,0.5)"
                  />
                  <div>
                    <h3 className="text-[13px] font-medium text-star-bright">
                      Mid maturity &middot; 40&ndash;70
                    </h3>
                    <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                      Standardizing workflows, first AI use cases in production.
                    </p>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={180} className="h-full">
                <div className="flex h-full items-center gap-4 rounded-xl border border-border-subtle bg-void/60 p-5 hover-card">
                  <LegendBubble
                    starIndex={2}
                    color="#00D9C0"
                    glow="rgba(0,217,192,0.5)"
                  />
                  <div>
                    <h3 className="text-[13px] font-medium text-star-bright">
                      High maturity &middot; 70&ndash;100
                    </h3>
                    <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                      Scaled AI deployment, governance in place, agents at
                      work.
                    </p>
                  </div>
                </div>
              </Reveal>
            </div>

            <Reveal delay={140} className="h-full">
              <div className="mt-6 flex h-full items-center gap-4 rounded-xl border border-trajectory/30 bg-trajectory/5 p-5 hover-card">
                <TrajectoryLine />
                <div>
                  <h3 className="text-[13px] font-medium text-trajectory">
                    Violet paths are trajectories
                  </h3>
                  <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                    The projected route from where a company is to where it
                    could be, complete with milestones and ROI.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─── 03 — How to use the galaxy ──────────────────────────── */}
        <section className="px-6 py-24 md:py-32">
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <p className={EYEBROW}>
                <span className="mr-3 font-mono tracking-[0.1em] text-[var(--ui-muted)]">
                  03
                </span>
                How to use the galaxy
              </p>
              <h2 className={`${HEADING} mt-3`}>Put yourself in it.</h2>
            </Reveal>

            <div className="mt-10 grid gap-3 md:grid-cols-2">
              <Reveal delay={60}>
                <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-void/60 p-6 hover-card">
                  <BreathingIcon starIndex={14}>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="#FF6B35"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M12 8.5v7M8.5 12h7" />
                    </svg>
                  </BreathingIcon>
                  <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                    Add your company
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                    A two-field form places your company as a star in the
                    galaxy, saves it to your browser, and shows you the
                    trajectory you could be on.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={120}>
                <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-void/60 p-6 hover-card">
                  <BreathingIcon starIndex={15}>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="#F7C548"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="4.5" />
                      <ellipse
                        cx="12"
                        cy="12"
                        rx="9"
                        ry="3.4"
                        transform="rotate(-16 12 12)"
                      />
                    </svg>
                  </BreathingIcon>
                  <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                    Planet-view deep dives
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                    Every star opens into a full profile: data infrastructure,
                    workflow standardization, AI deployment, governance, and
                    talent, each scored 0&ndash;100.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={180}>
                <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-void/60 p-6 hover-card">
                  <BreathingIcon starIndex={16}>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="#7B61FF"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <path d="M4 17.5 C 10 17.5, 12 6.5, 20 6.5" />
                      <circle
                        cx="20"
                        cy="6.5"
                        r="1.6"
                        fill="#7B61FF"
                        stroke="none"
                      />
                    </svg>
                  </BreathingIcon>
                  <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                    Transformation trajectories
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                    Projected EBITDA impact, exit-multiple improvement, and
                    milestone-by-milestone plans drawn in 3D space.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={240}>
                <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-void/60 p-6 hover-card">
                  <BreathingIcon starIndex={17}>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="#00D9C0"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="M16 16 20.5 20.5" />
                    </svg>
                  </BreathingIcon>
                  <h3 className="mt-4 text-[15px] font-semibold text-star-bright">
                    Search the galaxy
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[var(--ui-dim)]">
                    Type any company name and fly straight to its star; every
                    one of the {COMPANY_COUNT} is a few keystrokes from its
                    full profile.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ─── 04 — Methodology ────────────────────────────────────── */}
        <section
          id="methodology"
          className="border-t border-border-subtle/60 bg-[var(--nebula)]/40 px-6 py-24 md:py-32"
        >
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <p className={EYEBROW}>
                <span className="mr-3 font-mono tracking-[0.1em] text-[var(--ui-muted)]">
                  04
                </span>
                The methodology
              </p>
              <h2 className={`${HEADING} mt-3`}>
                Five pillars, one number.
              </h2>
              <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--ui-dim)]">
                Every star&apos;s color comes from a single overall maturity
                score, a weighted judgment of five dimensions. Open any planet
                in the galaxy and each bar links to the public evidence it was
                derived from.
              </p>
            </Reveal>

            {/* Five pillars as a divided list */}
            <Reveal delay={60}>
              <div className="mt-10 divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-void/60">
                {DIMENSIONS.map((d, i) => (
                  <div
                    key={d.key}
                    className="grid gap-1.5 px-5 py-4 transition-colors hover:bg-[var(--nebula)]/40 sm:grid-cols-[64px_1fr] sm:gap-6"
                  >
                    <span className="pt-0.5 font-mono text-[11px] tracking-[0.1em] text-[var(--ui-muted)]">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h4 className="text-[13px] font-semibold text-star-bright">
                        {d.label}
                      </h4>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--ui-dim)]">
                        {d.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* Scoring explainer */}
            <Reveal delay={80}>
              <div className="mt-8 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border-subtle bg-[var(--nebula)]/40 p-5 hover-card">
                  <h4 className="text-[13px] font-medium text-[var(--ui-dim)]">
                    How the five become one
                  </h4>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--ui-dim)]">
                    The overall score is a weighted judgment, not a strict
                    average. AI Deployment and Data Infrastructure carry the
                    most weight because that is where transformation shows up
                    in public evidence; Governance and Talent act as durability
                    multipliers that decide whether the deployment holds. Exact
                    weights stay unpublished deliberately: the overall is an
                    analyst-style judgment, not a mechanical formula.
                  </p>
                </div>
                <div className="rounded-xl border border-border-subtle bg-[var(--nebula)]/40 p-5 hover-card">
                  <h4 className="text-[13px] font-medium text-[var(--ui-dim)]">
                    Judged against the sector
                  </h4>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--ui-dim)]">
                    Every planet profile compares each pillar against its
                    industry&apos;s median, computed from this same dataset. A
                    bar above the dashed line outperforms its sector; below it,
                    the company lags. The comparison matters as much as the
                    number, which is why each score is read in context.
                  </p>
                </div>
              </div>
            </Reveal>

            {/* Source note */}
            <Reveal delay={100}>
              <div className="mt-6 rounded-xl border border-border-subtle bg-[var(--nebula)]/40 p-6 hover-card">
                <h4 className="text-[13px] font-medium text-[var(--ui-dim)]">
                  Where the scores come from
                </h4>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--ui-dim)]">
                  Directional 0-100 estimates synthesized from public AI
                  disclosures: earnings-call commentary, product launches,
                  reported deployments, and responsible-AI pages. Every score
                  links to the evidence it is derived from. Research use only,
                  not investment advice.
                </p>
                <Link
                  href="/methodology"
                  prefetch={false}
                  className="mt-4 inline-block rounded-md border border-trajectory/40 bg-trajectory/10 px-4 py-2 text-[12px] font-semibold text-trajectory transition hover:bg-trajectory/20 hover:text-star-bright active:scale-[0.98]"
                >
                  Read the full methodology and research trail →
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─── 05 — Get in touch ───────────────────────────────────── */}
        <section
          id="contact"
          className="border-t border-border-subtle/60 bg-[var(--nebula)]/40 px-6 py-24"
        >
          <div className="mx-auto max-w-3xl text-center">
            <Reveal>
              <p className={EYEBROW}>
                <span className="mr-3 font-mono tracking-[0.1em] text-[var(--ui-muted)]">
                  05
                </span>
                Get in touch
              </p>
              <h2 className={`${HEADING} mt-3`}>
                Ready to map your own AI transformation?
              </h2>
            </Reveal>
            <p className="mx-auto mt-4 max-w-lg text-[14px] leading-relaxed text-[var(--ui-dim)]">
              Add your company to the galaxy and see the trajectory you could
              be on, or reach out to Primero for a full maturity assessment.
            </p>
            <div className="mt-8 flex flex-col items-center gap-6">
              <Link
                href="/galaxy"
                prefetch={false}
                className="cta-primary rounded-md bg-maturity-high px-6 py-3 text-sm font-semibold text-void"
              >
                Add your company to the galaxy
              </Link>
              <div className="w-full max-w-xl">
                <ContactForm />
              </div>
            </div>
          </div>
        </section>

        {/* ─── Final CTA ───────────────────────────────────────────── */}
        <section className="bg-[var(--void)]/40 px-6 py-32 text-center">
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
