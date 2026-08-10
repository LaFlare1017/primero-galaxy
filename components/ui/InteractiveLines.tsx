// Reactive Lines: Originkit
// Originkit, defaults rewritten to match preview.
"use client";

import { useEffect, useRef } from "react";

type Vec = { x: number; y: number };
const vec = (x: number, y: number): Vec => ({ x, y });
const vecAdd = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const vecSub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const vecMult = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
const vecLerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, mn: number, mx: number) =>
  Math.max(mn, Math.min(mx, v));
const map = (v: number, a: number, b: number, c: number, d: number) =>
  ((v - a) / (b - a)) * (d - c) + c;

function toRGB(str: string): { r: number; g: number; b: number } {
  if (str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(",").map((s) => parseFloat(s));
      return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0 };
    }
    const hex = str.replace("#", "");
    if (hex.length >= 6)
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    if (hex.length === 3)
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
  }
  return { r: 10, g: 10, b: 10 };
}

interface CanvasState {
  width: number;
  height: number;
  dpr: number;
  isVisible: boolean;
  isPageVisible: boolean;
  animationId: number;
}

function useCanvasAnimation({
  deferStart = false,
  onSetup,
  onDraw,
}: {
  deferStart?: boolean;
  onSetup?: (ctx: CanvasRenderingContext2D, state: CanvasState) => void;
  onDraw: (ctx: CanvasRenderingContext2D, state: CanvasState) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<CanvasState>({
    width: 0,
    height: 0,
    dpr: 1,
    isVisible: true,
    isPageVisible: true,
    animationId: 0,
  });

  const onDrawRef = useRef(onDraw);
  onDrawRef.current = onDraw;
  const onSetupRef = useRef(onSetup);
  onSetupRef.current = onSetup;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const st = stateRef.current;

    // Under prefers-reduced-motion the canvas draws one static frame (on
    // mount and after resizes) and never starts the animation loop, matching
    // the app's CSS handling of the legend bubbles. Evaluated once at mount.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const drawStatic = () => {
      onDrawRef.current(ctx, st);
    };

    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      st.width = rect.width;
      st.height = rect.height;
      st.dpr = dpr;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const loop = () => {
      onDrawRef.current(ctx, st);
      st.animationId = requestAnimationFrame(loop);
    };

    const start = () => {
      if (reduceMotion) return; // static frame only, never animate
      if (!st.animationId && st.isVisible && st.isPageVisible) {
        st.animationId = requestAnimationFrame(loop);
      }
    };

    const stop = () => {
      if (st.animationId) {
        cancelAnimationFrame(st.animationId);
        st.animationId = 0;
      }
    };

    setup();
    onSetupRef.current?.(ctx, st);

    if (reduceMotion) {
      // A single static frame instead of the animation loop.
      drawStatic();
    } else if (!deferStart) {
      start();
    }

    let debTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(debTimer);
      debTimer = setTimeout(() => {
        stop();
        setup();
        reduceMotion ? drawStatic() : start();
      }, 100);
    };

    const onPageVis = () => {
      st.isPageVisible = document.visibilityState === "visible";
      st.isPageVisible ? start() : stop();
    };

    const io = new IntersectionObserver(
      (entries) => {
        st.isVisible = entries[0]?.isIntersecting ?? true;
        st.isVisible && st.isPageVisible ? start() : stop();
      },
      { threshold: 0 }
    );

    io.observe(container);
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onPageVis);

    (canvas as any).__canvasStart = start;

    return () => {
      stop();
      clearTimeout(debTimer);
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onPageVis);
    };
  }, [deferStart]);

  return { containerRef, canvasRef, stateRef };
}

interface InteractiveLinesProps {
  backgroundColor?: string;
  lineColor?: string;
  lineWidth?: number;
  minLines?: number;
  maxLines?: number;
  fade?: boolean;
  fadeIntensity?: number;
  style?: React.CSSProperties;
}

export default function InteractiveLines({
  style,
  backgroundColor = "rgb(10, 10, 10)",
  lineColor = "#ABABC7",
  lineWidth = 0.5,
  minLines = 108,
  maxLines = 15,
  fade = false,
  fadeIntensity = 15,
}: InteractiveLinesProps) {
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const cfgRef = useRef({ linesNum: 40, bias: 0.5 });

  const { containerRef, canvasRef, stateRef } = useCanvasAnimation({
    // Start on load: the background must be visible without a mouse move,
    // since touch devices never fire one and deferring would leave a blank
    // canvas.
    deferStart: false,

    onSetup: (e, t) => {
      mouseRef.current.targetX = t.width / 2;
      mouseRef.current.targetY = t.height / 2;
      mouseRef.current.x = t.width / 2;
      mouseRef.current.y = t.height / 2;
    },

    onDraw: (e, t) => {
      let { width: r, height: n } = t;
      let a = mouseRef.current;
      let o = cfgRef.current;

      a.x = a.x + (a.targetX - a.x) * 0.05;
      a.y = a.y + (a.targetY - a.y) * 0.1;

      e.fillStyle = backgroundColor;
      e.fillRect(0, 0, r, n);

      e.save();
      e.translate(r / 2, n / 2);

      let s = r < 500;
      let u = s ? 0.8 * n : 0;
      let d = s ? 1.5 : 0.7;

      let c = vec(r, -(1.1 * n) + u);
      let f = vec(0, 2 * n);
      let g = vec(-r, -n + u);

      let lo = Math.min(minLines, maxLines);
      let hi = Math.max(minLines, maxLines);
      let h = clamp(map(a.y, 0, n, lo, hi), lo, hi);
      o.linesNum = lerp(o.linesNum, h, 0.1);

      let b = clamp(map(a.x, 0, r, 0.6, 0.4), 0.4, 0.6);
      o.bias = lerp(o.bias, b, 0.05);

      e.strokeStyle = lineColor;
      e.lineWidth = lineWidth;

      for (let t = 0; t < o.linesNum; t++) {
        let r = t / (o.linesNum - 1);

        let lineEnd = vec(
          lerp(f.x, g.x, 1 - r * r),
          lerp(f.y, g.y, 1 - r * r)
        );

        let l = vecAdd(vecMult(c, 0.5), vecMult(lineEnd, 0.5));

        let dispTarget = vecMult(vecAdd(f, l), 0.5);

        (function (
          e: CanvasRenderingContext2D,
          t: Vec,
          r: Vec,
          n: Vec,
          l: number,
          a: number
        ) {
          let o = vecLerp(t, r, 0.5);
          let s = vecSub(n, o);

          e.beginPath();
          for (let n = 0; n <= 50; n++) {
            let o = n / 50;
            let u = vecLerp(t, r, o);
            let d =
              2 *
              Math.pow(o, a * (1 - l) * 2) *
              Math.pow(1 - o, a * l * 2);
            let cv = vecAdd(u, vecMult(s, d));
            n === 0 ? e.moveTo(cv.x, cv.y) : e.lineTo(cv.x, cv.y);
          }
          e.stroke();
        })(e, c, lineEnd, dispTarget, o.bias, d);
      }

      e.restore();

      if (fade) {
        const bg = toRGB(backgroundColor);
        const rgba = (alpha: number) =>
          `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${alpha})`;
        const inner = clamp(
          map(fadeIntensity, 1, 50, 0.82, 0.25),
          0.25,
          0.82
        );
        const maxA = clamp(
          map(fadeIntensity, 1, 50, 0.35, 0.9),
          0.35,
          0.9
        );
        e.save();
        let y = r / 2;
        let v = n / 2;
        let x = Math.max(r, n) / 2;
        e.translate(y, v);
        e.scale(r / (2 * x), n / (2 * x));
        let _ = e.createRadialGradient(0, 0, 0, 0, 0, x);
        _.addColorStop(0, rgba(0));
        _.addColorStop(inner, rgba(0));
        _.addColorStop(lerp(inner, 1, 0.5), rgba(maxA * 0.3));
        _.addColorStop(lerp(inner, 1, 0.8), rgba(maxA * 0.7));
        _.addColorStop(1, rgba(maxA));
        e.fillStyle = _;
        e.fillRect(-x, -x, 2 * x, 2 * x);
        e.restore();
      }
    },
  });

  useEffect(() => {
    let e = containerRef.current;
    if (!e) return;

    let t = e.getBoundingClientRect();

    // Mouse AND touch drive the pattern: touchmove keeps the background
    // interactive on devices with no cursor. The loop starts on load, so
    // this only re-targets the pointer/finger; nothing here gates whether
    // the animation runs.
    let target = (clientX: number, clientY: number) => {
      if (!stateRef.current.isVisible) return;
      mouseRef.current.targetX = clientX - t.left;
      mouseRef.current.targetY = clientY - t.top;
    };
    let r = (ev: MouseEvent) => target(ev.clientX, ev.clientY);
    let touch = (ev: TouchEvent) => {
      const pt = ev.touches[0];
      if (pt) target(pt.clientX, pt.clientY);
    };

    let n = 0;
    let i = () => {
      n ||
        (n = requestAnimationFrame(() => {
          t = e!.getBoundingClientRect();
          n = 0;
        }));
    };

    document.addEventListener("mousemove", r, { passive: true });
    document.addEventListener("touchmove", touch, { passive: true });
    window.addEventListener("scroll", i, { passive: true });

    // Debug handle (harmless in prod): expose the pattern's pointer target so
    // tests can assert mouse/touch input reaches it; pixel hashes alone
    // can't, because the line count converges asymptotically after load.
    const handle = window as unknown as Record<string, unknown>;
    handle.__lines = {
      ...((handle.__lines as Record<string, unknown>) ?? {}),
      target: () => ({ x: mouseRef.current.targetX, y: mouseRef.current.targetY }),
    };

    return () => {
      document.removeEventListener("mousemove", r);
      document.removeEventListener("touchmove", touch);
      window.removeEventListener("scroll", i);
      n && cancelAnimationFrame(n);
    };
  }, [containerRef, stateRef, canvasRef]);

  return (
    <div
      ref={containerRef}
      style={{
        ...style,
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
