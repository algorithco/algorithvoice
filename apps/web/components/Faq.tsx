"use client";

import { useState } from "react";

// FAQ accordion: single open item, grid-rows animation, monochrome plus icon.
export function Faq({ items }: { items: [string, string][] }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map(([q, a], i) => {
        const isOpen = open === i;
        return (
          <div key={q}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? -1 : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 py-4 text-left"
            >
              <span className="t-body font-medium">{q}</span>
              <span
                aria-hidden
                className="shrink-0 text-xl leading-none text-sub transition-transform duration-200 ease-app"
                style={{ transform: isOpen ? "rotate(45deg)" : "none" }}
              >
                +
              </span>
            </button>
            <div
              className="grid transition-all duration-200 ease-app"
              style={{
                gridTemplateRows: isOpen ? "1fr" : "0fr",
                opacity: isOpen ? 1 : 0,
              }}
            >
              <div className="overflow-hidden">
                <p className="t-body max-w-[68ch] pb-4 text-sub">{a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
