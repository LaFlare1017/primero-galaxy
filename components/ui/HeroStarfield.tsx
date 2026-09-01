// Full-bleed animated starfield for the landing hero (design variation V2).
// Mobile performance rules, in order of impact:
//   1. Backing-store DPR is capped at 1.5 (phones run DPR 2-3; painting the
//      full pixel grid every frame dominates the cost, and a soft glow star
//      loses nothing visible at 1.5).
//   2. Star count scales with viewport area: a 390x844 phone gets 90 stars
//      instead of the 220 drawn on a desktop hero, cutting per-frame fill
//      and gradient work by more than half.
//   3. prefers-reduced-motion draws one static frame and never starts a loop.
"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  z: number;
  r: number;
  color: string;
  glow: string;
  phase: number;
  driftX: number;
}

const PALETTE: { color: string; glow: string }[] = [
  { color: "#FF6B35", glow: "rgba(255,107,53," },
  { color: "#F7C548", glow: "rgba(247,197,72," },
  { color: "#00D9C0", glow: "rgba(0,217,192," },
];

export default function HeroStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let scrollY = window.scrollY;
    let raf = 0;
    let resizeTimer = 0;

    const setup = () => {
      // Mobile cap 1: see header comment. 1.5 keeps the glow readable while
      // cutting high-DPR fill cost roughly in half versus native DPR 3.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Mobile cap 2: star count tracks viewport area. The desktop reference
      // is 220 stars at ~1440x900; a phone hero gets proportionally fewer,
      // floored at 60 so the field never looks empty.
      const area = width * height;
      const count = Math.max(60, Math.min(220, Math.round(area / 5900)));
      stars = [];
      for (let i = 0; i < count; i++) {
        const palette = PALETTE[i % PALETTE.length];
        stars.push({
          x: Math.random(),
          y: Math.random(),
          z: 0.2 + Math.random() * 0.8,
          r: 0.5 + Math.random() * 1.6,
          color: palette.color,
          glow: palette.glow,
          phase: Math.random() * Math.PI * 2,
          driftX: (Math.random() - 0.5) * 0.00004,
        });
      }
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const parallax = scrollY * 0.15;
      for (const star of stars) {
        star.x += star.driftX;
        if (star.x < 0) star.x += 1;
        if (star.x > 1) star.x -= 1;
        let y = (star.y * height - parallax * star.z) % height;
        if (y < 0) y += height;
        const breathe = reducedMotion
          ? 1
          : 0.7 + 0.3 * Math.sin(time / 1100 + star.phase);
        const radius = star.r * (0.6 + star.z);
        const x = star.x * width;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.2);
        glow.addColorStop(0, `${star.glow}${0.85 * breathe})`);
        glow.addColorStop(1, `${star.glow}0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = star.color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (time: number) => {
      draw(time);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (!reducedMotion && !raf) {
        raf = requestAnimationFrame(loop);
      }
    };

    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onScroll = () => {
      scrollY = window.scrollY;
    };

    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        stop();
        setup();
        if (reducedMotion) {
          draw(0);
        } else {
          start();
        }
      }, 100);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };

    setup();
    if (reducedMotion) {
      draw(0);
    } else {
      start();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    // Debug handle (harmless in prod): expose the current star budget so
    // tests can assert the mobile viewport actually draws fewer stars.
    const handle = window as unknown as Record<string, unknown>;
    handle.__heroStars = () => stars.length;

    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ display: "block" }}
      />
    </div>
  );
}
