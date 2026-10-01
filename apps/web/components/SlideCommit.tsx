"use client";

import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";

import "./SlideCommit.css";

const PAD = 4;
const SQUASH_MAX = 0.08;
const SQUASH_DIV = 110;
const SWELL = 1.03;
const MIN_PENDING = 300;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SHAKE: number[] = [0, -5, 5, -3, 3, -1, 0];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const onColor = (hex: string) => {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3 ? [...raw].map((ch) => ch + ch).join("") : raw.slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "#ffffff";
  const yiq =
    (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
  return yiq >= 128 ? "#111111" : "#ffffff";
};
const velocityOf = (hist: [number, number][]) => {
  if (hist.length < 2) return 0;
  const [t0, x0] = hist[0];
  const [t1, x1] = hist[hist.length - 1];
  return ((x1 - x0) / Math.max(1, t1 - t0)) * 1000;
};
const finePointer = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

const Spinner = ({ size }: { size: number }) => (
  <svg
    className="slide-commit__spinner"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeOpacity="0.25"
    />
    <path
      d="M12 3a9 9 0 0 1 9 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  </svg>
);

const ArrowIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </svg>
);
const TickIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5 13l4 4L19 7" />
  </svg>
);

export default function SlideCommit({
  label = "Slide to pay",
  doneLabel = "Paid",
  errorLabel = "Payment failed",
  onConfirm,
  onDone,
  onError,
  trackColor = "#262626",
  handleColor = "#f5f5f5",
  successColor = "#22c55e",
  dangerColor = "#e5484d",
  width = 280,
  height = 56,
  radius = 28,
  speed = 50,
  returnBounce = 0.38,
  landingDip = 0.026,
  holdMs = 1500,
  disabled = false,
  icon,
  className = "",
}: {
  label?: string;
  doneLabel?: string;
  errorLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onDone?: () => void;
  onError?: (reason: unknown) => void;
  trackColor?: string;
  handleColor?: string;
  successColor?: string;
  dangerColor?: string;
  width?: number;
  height?: number;
  radius?: number;
  speed?: number;
  returnBounce?: number;
  landingDip?: number;
  holdMs?: number;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "pending" | "done" | "error">(
    "idle",
  );
  const [held, setHeld] = useState(false);
  const [hot, setHot] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const grip = useRef<{
    id: number;
    grab: number | null;
    moved: boolean;
    hist: [number, number][];
  } | null>(null);
  const timer = useRef<number>(0);
  const homeTimer = useRef<number>(0);
  const run = useRef(0);
  const unwatch = useRef<(() => void) | null>(null);
  const live = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
  }>({ move: () => {}, up: () => {} });
  const lastPercent = useRef(0);

  const GRIP = height - PAD * 2;
  const INNER = width - PAD * 2;
  const TRAVEL = Math.max(1, INNER - GRIP);
  const r = clamp(radius, 0, height / 2);
  const gripR = Math.max(0, r - PAD);
  const k = 260 + (clamp(speed, 0, 100) / 100) * 640;
  const mass = 0.9;
  const critical = 2 * Math.sqrt(k * mass);
  const commitSpring = {
    type: "spring" as const,
    stiffness: k,
    damping: critical,
    mass,
  };
  const homeSpring = {
    ...commitSpring,
    damping: critical * (1 - clamp(returnBounce, 0, 0.5)),
  };

  const x = useMotionValue(0);
  const anchor = useMotionValue(0);
  const shown = useMotionValue(1);
  const spin = useMotionValue(0);
  const pulse = useMotionValue(1);
  const shake = useMotionValue(0);
  const seen = useTransform(x, (v) => clamp(v, 0, TRAVEL));
  const edge = useTransform(
    [seen, anchor],
    ([v, a]) =>
      (v as number) + GRIP + clamp((a as number) - (v as number), 0, TRAVEL),
  );
  const clip = useTransform(
    edge,
    (R) => `inset(0 ${INNER - (R as number)}px 0 0 round ${gripR}px)`,
  );
  const content = useTransform(
    [seen, edge],
    ([v, R]) =>
      `translateX(${((v as number) + (R as number)) / 2 - INNER / 2}px)`,
  );
  const swell = hot && !held && phase === "idle" && !reduce ? SWELL : 1;
  const shape = useTransform(x, (v) => {
    const q =
      1 - Math.min(SQUASH_MAX, Math.max(0, -(v as number)) / SQUASH_DIV);
    return `scale(${q * swell}, ${swell / q})`;
  });
  const origin = useTransform(seen, (v) => `${v as number}px 50%`);
  const say = useTransform(seen, [0, TRAVEL * 0.55], [1, 0]);
  const arrow = useTransform(
    [seen, shown],
    ([v, on]) =>
      (on as number) *
      clamp(1 - ((v as number) - TRAVEL * 0.55) / (TRAVEL * 0.4), 0, 1),
  );
  const trackTransform = useTransform(
    [shake, pulse],
    ([s, p]) => `translateX(${s as number}px) scale(${p as number})`,
  );

  const labelText = typeof label === "string" ? label : "Slide to confirm";
  useMotionValueEvent(seen, "change", (v) => {
    const val = v as number;
    const percent = Math.round((val / TRAVEL) * 100);
    if (percent === lastPercent.current || !capsuleRef.current) return;
    lastPercent.current = percent;
    capsuleRef.current.setAttribute("aria-valuenow", String(percent));
    capsuleRef.current.setAttribute(
      "aria-valuetext",
      `${labelText}, ${percent}%`,
    );
  });

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(homeTimer.current);
      unwatch.current?.();
      run.current += 1;
    },
    [],
  );

  const local = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (clientX - rect.left) / (rect.width / width || 1);
  };

  const goHome = (velocity: number) => {
    if (reduce)
      animate(x, 0, { duration: 0.2, ease: EASE_OUT as unknown as never });
    else animate(x, 0, { ...homeSpring, velocity: Math.min(0, velocity) });
  };

  const settle = () => {
    setPhase("idle");
    animate(shown, 1, { duration: 0.2, delay: 0.12 });
    if (reduce) anchor.set(0);
    else animate(anchor, 0, { type: "spring", duration: 0.3, bounce: 0 });
  };

  const resolve = (viaKey: boolean) => {
    setPhase("done");
    anchor.set(x.get());
    animate(spin, 0, { duration: 0.12 });
    if (reduce) x.set(0);
    else {
      animate(x, 0, commitSpring);
      if (!viaKey && landingDip > 0) {
        animate(
          pulse as unknown as never,
          [1, 1 - landingDip, 1] as unknown as never,
          {
            duration: 0.46,
            times: [0, 0.62, 1],
            ease: EASE_OUT as unknown as never,
            delay: 0.1,
          } as unknown as never,
        );
      }
    }
    onDone?.();
    if (holdMs > 0) timer.current = window.setTimeout(settle, holdMs);
  };

  const reject = (reason: unknown) => {
    setPhase("error");
    onError?.(reason);
    animate(spin, 0, { duration: 0.12 });
    animate(shown, 1, { duration: 0.2, delay: 0.12 });
    if (reduce) goHome(0);
    else {
      animate(
        shake as unknown as never,
        SHAKE as unknown as never,
        {
          duration: 0.45,
          ease: EASE_OUT as unknown as never,
        } as unknown as never,
      );
      homeTimer.current = window.setTimeout(() => {
        if (!grip.current) goHome(0);
      }, 300);
    }
    timer.current = window.setTimeout(
      () => setPhase("idle"),
      Math.max(holdMs, 1500),
    );
  };

  const commit = (viaKey: boolean) => {
    clearTimeout(timer.current);
    const id = ++run.current;
    x.set(TRAVEL);
    let out: unknown;
    try {
      out = onConfirm?.();
    } catch (reason) {
      reject(reason);
      return;
    }
    const pending =
      out && typeof (out as Promise<unknown>).then === "function"
        ? (out as Promise<unknown>)
        : null;
    if (!pending) {
      animate(shown, 0, { duration: 0.12 });
      resolve(viaKey);
      return;
    }
    setPhase("pending");
    animate(shown, 0, { duration: 0.2 });
    animate(spin, 1, { duration: 0.2 });
    const t0 = performance.now();
    const later = (fn: () => void) => {
      setTimeout(
        () => {
          if (id === run.current) fn();
        },
        Math.max(0, MIN_PENDING - (performance.now() - t0)),
      );
    };
    pending.then(
      () => later(() => resolve(viaKey)),
      (reason) => later(() => reject(reason)),
    );
  };

  const down = (e: React.PointerEvent) => {
    if (
      disabled ||
      grip.current ||
      phase === "pending" ||
      phase === "done" ||
      e.button !== 0
    )
      return;
    x.stop();
    grip.current = { id: e.pointerId, grab: null, moved: false, hist: [] };
    setHeld(true);
    try {
      trackRef.current?.setPointerCapture(e.pointerId);
    } catch {}
    unwatch.current?.();
    const onMove = (ev: PointerEvent) => ev.isTrusted && live.current.move(ev);
    const onUp = (ev: PointerEvent) => ev.isTrusted && live.current.up(ev);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    unwatch.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      unwatch.current = null;
    };
  };

  const move = (e: PointerEvent) => {
    const g = grip.current;
    if (!g || g.id !== e.pointerId) return;
    const at = local(e.clientX);
    if (g.grab === null) {
      g.grab = at - x.get();
      return;
    }
    const next = clamp(at - g.grab, 0, TRAVEL);
    if (Math.abs(next - x.get()) > 0.5) g.moved = true;
    g.hist.push([e.timeStamp, next]);
    if (g.hist.length > 4) g.hist.shift();
    x.set(next);
  };

  const up = (e: PointerEvent) => {
    const g = grip.current;
    if (!g || g.id !== e.pointerId) return;
    grip.current = null;
    unwatch.current?.();
    try {
      trackRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
    setHeld(false);
    if (x.get() >= TRAVEL) commit(false);
    else if (g.moved) goHome(velocityOf(g.hist));
  };
  live.current = { move, up };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || phase === "pending" || phase === "done") return;
    const step = TRAVEL / 10;
    if (e.key === "End") {
      e.preventDefault();
      commit(true);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(TRAVEL, x.get() + step);
      x.set(next);
      if (next >= TRAVEL) commit(true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      x.set(Math.max(0, x.get() - step));
    } else if (e.key === "Home" || e.key === "Escape") {
      e.preventDefault();
      if (grip.current)
        up({ pointerId: grip.current.id } as unknown as PointerEvent);
      else x.set(0);
    }
  };

  const fontSize = clamp(Math.round(height * 0.25), 13, 17);
  const iconSize = Math.round(GRIP * 0.42);
  const done = phase === "done";

  return (
    <div
      className={`slide-commit${className ? ` ${className}` : ""}`}
      data-phase={phase}
      data-held={held ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      style={
        {
          width,
          height,
          "--sc-track": trackColor,
          "--sc-ink": handleColor,
          "--sc-ok": successColor,
          "--sc-no": dangerColor,
          "--sc-on-ink": onColor(handleColor),
          "--sc-on-ok": onColor(successColor),
          "--sc-on-no": onColor(dangerColor),
          "--sc-radius": `${r}px`,
          "--sc-grip-r": `${gripR}px`,
          "--sc-pad": `${PAD}px`,
          "--sc-font": `${fontSize}px`,
        } as React.CSSProperties
      }
    >
      <motion.div
        ref={trackRef}
        className="slide-commit__track"
        style={{ transform: trackTransform as unknown as string }}
        onPointerDown={down}
      >
        <motion.span
          className="slide-commit__label"
          style={{ opacity: say as unknown as string }}
          aria-hidden="true"
        >
          <span className="slide-commit__text slide-commit__text--plain">
            {label}
          </span>
          <span className="slide-commit__text slide-commit__text--error">
            {errorLabel}
          </span>
        </motion.span>
        <motion.div
          ref={capsuleRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={labelText}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          aria-busy={phase === "pending" || undefined}
          aria-disabled={disabled || undefined}
          className="slide-commit__capsule"
          style={{
            clipPath: clip as unknown as string,
            transform: shape as unknown as string,
            transformOrigin: origin as unknown as string,
          }}
          onPointerEnter={(e) => {
            if (
              (e as React.PointerEvent).pointerType === "mouse" &&
              finePointer()
            )
              setHot(true);
          }}
          onPointerLeave={() => setHot(false)}
          onKeyDown={onKeyDown}
        >
          <motion.div
            className="slide-commit__content"
            style={{ transform: content as unknown as string }}
          >
            <motion.span
              className="slide-commit__arrow"
              style={{ opacity: arrow as unknown as string }}
              aria-hidden="true"
            >
              {icon ?? <ArrowIcon size={iconSize} />}
            </motion.span>
            <motion.span
              className="slide-commit__spin"
              style={{ opacity: spin as unknown as string }}
              aria-hidden="true"
            >
              <Spinner size={iconSize} />
            </motion.span>
            <motion.span
              className="slide-commit__done"
              aria-hidden="true"
              initial={false}
              animate={{
                opacity: done ? 1 : 0,
                scale: done || reduce ? 1 : 0.95,
              }}
              transition={{ duration: 0.2, ease: EASE_OUT as unknown as never }}
            >
              <TickIcon size={Math.round(GRIP * 0.38)} />
              {doneLabel}
            </motion.span>
          </motion.div>
        </motion.div>
        <span className="slide-commit__sr" aria-live="polite">
          {phase === "pending"
            ? "Working"
            : phase === "done"
              ? doneLabel
              : phase === "error"
                ? errorLabel
                : ""}
        </span>
      </motion.div>
    </div>
  );
}
