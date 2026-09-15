"use client";

import { cn } from "@algorith-voice/ui";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import MorphSVGPlugin from "gsap/MorphSVGPlugin";
import type * as React from "react";
import { useRef } from "react";

gsap.registerPlugin(MorphSVGPlugin);

// V5 — morph-wave fill. Smooth by construction: single rAF timeline,
// power2 easing, fill covers from the bottom. Respects reduced-motion
// (no morph, instant colour swap) and keeps the V5 monochrome tokens.
export interface MorphButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export function MorphButton({
  className,
  disabled = false,
  children,
  ...props
}: MorphButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useGSAP(
    () => {
      const el = buttonRef.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // Disable wave on touch / small screens — keep static white button there.
      if (
        window.matchMedia("(max-width: 640px)").matches ||
        window.matchMedia("(hover: none)").matches ||
        window.matchMedia("(pointer: coarse)").matches
      )
        return;

      const start = "M 0 100 V 50 Q 50 0 100 50 V 100 z";
      const end = "M 0 100 V 0 Q 50 0 100 0 V 100 z";

      const fillTl = gsap.timeline({ paused: true });
      fillTl
        .to(".morph-path", {
          morphSVG: start,
          ease: "power2.in",
          duration: 0.22,
        })
        .to(".morph-path", {
          morphSVG: end,
          ease: "power2.out",
          duration: 0.3,
        });

      const textTl = gsap.timeline({ paused: true });
      textTl.from(".morph-text", { color: "#ffffff" }).to(".morph-text", {
        color: "#000000",
        duration: 0.45,
        ease: "power2.inOut",
      });

      const onEnter = () => {
        if (disabled) return;
        fillTl.play();
        textTl.play();
      };
      const onLeave = () => {
        fillTl.reverse();
        textTl.reverse();
      };

      el.addEventListener("mouseenter", onEnter);
      el.addEventListener("mouseleave", onLeave);
      el.addEventListener("focus", onEnter);
      el.addEventListener("blur", onLeave);

      return () => {
        el.removeEventListener("mouseenter", onEnter);
        el.removeEventListener("mouseleave", onLeave);
        el.removeEventListener("focus", onEnter);
        el.removeEventListener("blur", onLeave);
      };
    },
    { scope: buttonRef, dependencies: [disabled] },
  );

  return (
    <button
      ref={buttonRef}
      disabled={disabled}
      className={cn(
        // Desktop: black shell, white text, wave reveals white fill.
        // Phone (≤640px or touch): static white — no wave, no JS needed.
        "relative isolate cursor-pointer overflow-hidden rounded-md border border-ink px-6 py-3 text-[15px] font-semibold leading-6 disabled:cursor-not-allowed disabled:opacity-50",
        "bg-canvas text-ink max-[640px]:bg-ink max-[640px]:text-canvas",
        "max-[640px]:hover:bg-ink",
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-0 max-[640px]:hidden">
        <svg
          style={{ width: "100%", height: "100%" }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="morph-path"
            fill="var(--v5-t1)"
            strokeWidth={0}
            vectorEffect="non-scaling-stroke"
            d="M 0 100 V 100 Q 50 100 100 100 V 100 z"
          />
        </svg>
      </div>
      <span className="morph-text relative z-10 max-[640px]:!text-canvas">
        {children ?? "Hover Me"}
      </span>
    </button>
  );
}

export default MorphButton;
