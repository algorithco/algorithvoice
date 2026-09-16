import { useEffect, useRef } from "react";
import "./ParticleLogoLoader.css";

type Particle = {
  // current
  x: number;
  y: number;
  // target (logo)
  tx: number;
  ty: number;
  // scattered start
  sx: number;
  sy: number;
  size: number;
  baseSize: number;
  opacity: number;
  baseOpacity: number;
  driftX: number;
  driftY: number;
  isEdge: boolean;
  delay: number;
  phase: number;
};

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t));
const easeInOutQuad = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

export default function ParticleLogoLoader({
  className = "",
  logoSize = 260,
  particleCount = 6800,
  cycleDuration = 7200,
  centerOffsetY = -46,
}: {
  className?: string;
  logoSize?: number;
  particleCount?: number;
  cycleDuration?: number;
  centerOffsetY?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rawCtx = canvas.getContext("2d", { alpha: false });
    if (!rawCtx) return;
    const ctx = rawCtx;

    let raf = 0;
    let particles: Particle[] = [];
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    // offscreen sampler - draw exact 4-bar logo and sample white pixels
    const buildTargets = (): { x: number; y: number }[] => {
      const S = 320;
      const off = document.createElement("canvas");
      off.width = S;
      off.height = S;
      const rawOctx = off.getContext("2d", { willReadFrequently: true });
      if (!rawOctx) return [];
      const octx = rawOctx;
      octx.fillStyle = "#000";
      octx.fillRect(0, 0, S, S);
      octx.fillStyle = "#fff";
      // exact geometry — reduced height ~10% to fix vertical stretch reported
      // original reference is slightly squatter than first estimate; keep proportions
      const scale = S / 1024;
      const barW = 124 * scale;
      const gap = 36 * scale;
      const startX = 210 * scale;
      // heights reduced 12% and re-centered to match reference silhouette
      const bars = [
        { x: startX, y: 332 * scale, w: barW, h: 376 * scale },
        { x: startX + (barW + gap), y: 188 * scale, w: barW, h: 648 * scale },
        {
          x: startX + 2 * (barW + gap),
          y: 248 * scale,
          w: barW,
          h: 532 * scale,
        },
        {
          x: startX + 3 * (barW + gap),
          y: 368 * scale,
          w: barW,
          h: 312 * scale,
        },
      ];
      for (const b of bars) octx.fillRect(b.x, b.y, b.w, b.h);
      const imgData = octx.getImageData(0, 0, S, S).data;
      const pts: { x: number; y: number }[] = [];
      // dense sampling: every white pixel, step 1 for max fidelity, then we'll downsample
      // collect with stride 1 then throttle to keep density uniform
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const idx = (y * S + x) * 4;
          if (imgData[idx] > 200) {
            // sub-pixel jitter for organic
            pts.push({
              x: x + (Math.random() - 0.5) * 0.6,
              y: y + (Math.random() - 0.5) * 0.6,
            });
          }
        }
      }
      return pts;
    };

    const allTargets = buildTargets();

    const init = () => {
      const rect = container.getBoundingClientRect();
      W = Math.max(1, Math.floor(rect.width));
      H = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // map sampled points to centered logo
      const S = 320;
      const scale = logoSize / S;
      const cx = W / 2;
      const cy = H / 2 + centerOffsetY;
      // shuffle targets
      for (let i = allTargets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = allTargets[i];
        const b = allTargets[j];
        if (a && b) {
          allTargets[i] = b;
          allTargets[j] = a;
        }
      }
      // pick particleCount targets, with replacement if not enough (wrap)
      const chosen: { x: number; y: number }[] = [];
      for (let i = 0; i < particleCount; i++) {
        const t = allTargets[i % allTargets.length];
        if (t) chosen.push(t);
      }

      particles = chosen.map((t, _i) => {
        const tx = cx + (t.x - S / 2) * scale;
        const ty = cy + (t.y - S / 2) * scale;
        // scattered start: random around screen + slight circle bias for cinematic
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.7 + Math.random() * 0.9; // 0.7..1.6 * max(W,H)
        const maxR = Math.max(W, H) * 0.75;
        const dist = radius * maxR * (0.5 + Math.random() * 0.5);
        // also mix with uniform random for loose field
        const useCircle = Math.random() < 0.65;
        const sx = useCircle ? cx + Math.cos(angle) * dist : Math.random() * W;
        const sy = useCircle ? cy + Math.sin(angle) * dist : Math.random() * H;
        // edge detection: near border of bar (approx by checking distance to bar edge)
        // we approximate by noise: 22% are edge particles
        const isEdge = Math.random() < 0.22;
        // size variation subtle 0.9 - 1.6 px
        const baseSize =
          0.9 + Math.random() * 0.7 + (isEdge ? Math.random() * 0.3 : 0);
        const baseOpacity = 0.85 + Math.random() * 0.15;
        // drift direction outward from center for edge particles
        const dx = tx - cx;
        const dy = ty - cy;
        const len = Math.hypot(dx, dy) || 1;
        const driftMag = isEdge ? 7 + Math.random() * 18 : 0;
        const driftX = (dx / len) * driftMag + (Math.random() - 0.5) * 4;
        const driftY = (dy / len) * driftMag + (Math.random() - 0.5) * 4;
        // per-particle delay for staggered assemble
        const delay =
          Math.random() * 0.14 +
          (Math.hypot(tx - cx, ty - cy) / (logoSize * 0.8)) * 0.06;
        return {
          x: sx,
          y: sy,
          tx,
          ty,
          sx,
          sy,
          size: baseSize,
          baseSize,
          opacity: baseOpacity,
          baseOpacity,
          driftX,
          driftY,
          isEdge,
          delay,
          phase: Math.random() * Math.PI * 2,
        };
      });
    };

    init();

    let start = performance.now();
    let isVisible = true;
    let isPageVisible = !document.hidden;

    const ro = new ResizeObserver(() => {
      init();
      start = performance.now();
    });
    ro.observe(container);

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry ? entry.isIntersecting : true;
        if (isVisible && isPageVisible && !raf)
          raf = requestAnimationFrame(loop);
      },
      { threshold: 0 },
    );
    io.observe(container);

    const onVis = () => {
      isPageVisible = !document.hidden;
      if (isVisible && isPageVisible && !raf) {
        start =
          performance.now() - ((performance.now() - start) % cycleDuration);
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    // pre-warm a bit so first frame isn't fully scattered for too long in preview
    // we keep scattered start as spec, but allow immediate animation

    function loop(now: number) {
      const elapsed = (now - start) % cycleDuration;
      const p = elapsed / cycleDuration; // 0..1

      // phases:
      // 0.00 - 0.38 : scatter -> assemble
      // 0.38 - 0.56 : hold + shimmer/breathe
      // 0.56 - 0.72 : edge drift out
      // 0.72 - 0.94 : drift return + reassemble
      // 0.94 - 1.00 : hold (perfect logo) before loop

      // per-frame shimmer time
      const tSec = now * 0.001;

      // clear to pure black
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);

      // subtle breathe scale for hold phases (global)
      const breathe = 1 + Math.sin(tSec * 0.9) * 0.008;

      // draw particles
      for (let i = 0; i < particles.length; i++) {
        const pt = particles[i];
        if (!pt) continue;
        let x: number;
        let y: number;
        let opacity = pt.baseOpacity;
        let size = pt.baseSize;

        // shimmer noise
        const n =
          Math.sin(tSec * 1.7 + pt.phase) * 0.5 +
          Math.cos(tSec * 2.3 + pt.phase * 0.7) * 0.3;
        const shimmerX = n * 0.35;
        const shimmerY = Math.cos(tSec * 1.9 + pt.phase) * 0.35;
        const shimmerO = n * 0.08;
        const pulseSize = 1 + Math.sin(tSec * 2.0 + pt.phase) * 0.07;

        if (p < 0.38) {
          // assemble
          const local = Math.max(
            0,
            Math.min(1, (p - pt.delay) / (0.38 - pt.delay)),
          );
          const eased =
            local < 0.5
              ? easeInOutCubic(local)
              : easeOutExpo(local * 0.88 + 0.12 * local);
          // also add subtle acceleration curve
          const e = easeInOutQuad(local);
          // interpolate
          const bx = pt.tx + (pt.tx - W / 2) * (breathe - 1) * 0.15;
          const by = pt.ty + (pt.ty - H / 2) * (breathe - 1) * 0.15;
          x = pt.sx + (bx - pt.sx) * e;
          y = pt.sy + (by - pt.sy) * eased;
          // add slight curve via perpendicular offset that decays
          const mid = Math.sin(local * Math.PI) * 6 * (Math.random() - 0.5);
          x += mid * (1 - eased);
          opacity = 0.3 + eased * 0.7 + shimmerO * 0.3;
          size = pt.baseSize * (0.6 + eased * 0.4) * pulseSize;
        } else if (p < 0.56) {
          // hold perfect + shimmer/breathe
          const bx = pt.tx + (pt.tx - W / 2) * (breathe - 1) * 0.12;
          const by = pt.ty + (pt.ty - H / 2) * (breathe - 1) * 0.12;
          x = bx + shimmerX;
          y = by + shimmerY;
          opacity = pt.baseOpacity + shimmerO;
          size = pt.baseSize * pulseSize;
          // occasional twinkle for 3% of particles
          if ((i * 997) % 97 === 0) {
            const tw = Math.sin(tSec * 5 + i) * 0.5 + 0.5;
            opacity += tw * 0.18;
            size += tw * 0.25;
          }
        } else if (p < 0.72) {
          // edge drift
          const local = (p - 0.56) / 0.16;
          const eased = easeInOutCubic(local);
          const bx =
            pt.tx +
            (pt.tx - W / 2) * (breathe - 1) * 0.12 +
            shimmerX * (1 - eased * 0.5);
          const by =
            pt.ty +
            (pt.ty - H / 2) * (breathe - 1) * 0.12 +
            shimmerY * (1 - eased * 0.5);
          const driftFactor = pt.isEdge ? eased : eased * 0.15 * Math.random();
          // drift outward + slight random swirl
          const swirl = Math.sin(local * Math.PI + pt.phase) * 1.2;
          x = bx + pt.driftX * driftFactor + swirl * (pt.isEdge ? 0.6 : 0);
          y = by + pt.driftY * driftFactor;
          opacity =
            pt.baseOpacity -
            driftFactor * 0.25 +
            shimmerO * (1 - driftFactor * 0.5);
          size = pt.baseSize * pulseSize * (1 - driftFactor * 0.12);
          opacity = Math.max(0.35, opacity);
        } else if (p < 0.94) {
          // return
          const local = (p - 0.72) / 0.22;
          const eased = easeInOutCubic(local);
          const bxDrift =
            pt.tx + pt.driftX * (pt.isEdge ? 1 : 0.15 * Math.random());
          const byDrift =
            pt.ty + pt.driftY * (pt.isEdge ? 1 : 0.15 * Math.random());
          const startX = pt.isEdge
            ? bxDrift
            : pt.tx + pt.driftX * 0.15 * Math.random();
          const startY = pt.isEdge
            ? byDrift
            : pt.ty + pt.driftY * 0.15 * Math.random();
          const targetX =
            pt.tx + (pt.tx - W / 2) * (breathe - 1) * 0.12 + shimmerX;
          const targetY =
            pt.ty + (pt.ty - H / 2) * (breathe - 1) * 0.12 + shimmerY;
          // add spring overshoot for cinematic snap
          const spring =
            1 - Math.cos(eased * Math.PI * 0.5) * (1 - eased) * 0.08;
          x = startX + (targetX - startX) * spring;
          y = startY + (targetY - startY) * spring;
          opacity = pt.baseOpacity + shimmerO * 0.7;
          size = pt.baseSize * pulseSize;
          // fade in as it returns
          const fadeIn = 0.6 + 0.4 * eased;
          opacity *= fadeIn;
        } else {
          // final hold perfect
          const bx = pt.tx + (pt.tx - W / 2) * (breathe - 1) * 0.12;
          const by = pt.ty + (pt.ty - H / 2) * (breathe - 1) * 0.12;
          x = bx + shimmerX * 0.7;
          y = by + shimmerY * 0.7;
          opacity = pt.baseOpacity + shimmerO * 0.5;
          size = pt.baseSize * pulseSize;
        }

        // clamp opacity
        if (opacity > 1) opacity = 1;
        if (opacity < 0) opacity = 0;

        // draw - tiny sharp white dot with subtle glow for dense core
        // use fillRect for 1px particles, arc for larger
        const drawSize = size;
        if (drawSize < 1.35) {
          ctx.globalAlpha = opacity;
          ctx.fillStyle = "#FFFFFF";
          // sharp 1px rect - most performant and sharpest
          ctx.fillRect(
            Math.round(x) - 0.5,
            Math.round(y) - 0.5,
            drawSize,
            drawSize,
          );
        } else {
          ctx.globalAlpha = opacity;
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.arc(x, y, drawSize * 0.55, 0, Math.PI * 2);
          ctx.fill();
          // subtle glow for larger particles (core)
          if (pt.baseSize > 1.2 && opacity > 0.8) {
            ctx.globalAlpha = opacity * 0.13;
            ctx.beginPath();
            ctx.arc(x, y, drawSize * 1.35, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      if (isVisible && isPageVisible) {
        raf = requestAnimationFrame(loop);
      }
    }

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [logoSize, particleCount, cycleDuration, centerOffsetY]);

  return (
    <div ref={containerRef} className={`particle-loader ${className}`.trim()}>
      <canvas ref={canvasRef} className="particle-loader-canvas" />
    </div>
  );
}
