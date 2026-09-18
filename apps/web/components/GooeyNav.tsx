"use client";

import { useEffect, useState } from "react";
import "./GooeyNav.css";

type GooeyNavItem = {
  label: string;
  href: string;
};

type GooeyNavProps = {
  items: GooeyNavItem[];
  initialActiveIndex?: number;
};

const GooeyNav = ({ items, initialActiveIndex = 0 }: GooeyNavProps) => {
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);

  // Keep active index in sync with URL without heavy observers
  useEffect(() => {
    const path = window.location.pathname;
    const idx = items.findIndex(
      (it) => path === it.href || (it.href !== "/" && path.startsWith(it.href)),
    );
    if (idx >= 0 && idx !== activeIndex) setActiveIndex(idx);
  }, [items, activeIndex]);

  return (
    <div className="gooey-nav-container">
      <nav>
        <ul>
          {items.map((item, index) => (
            <li
              key={item.href}
              className={activeIndex === index ? "active" : ""}
            >
              <a
                href={item.href}
                onClick={() => setActiveIndex(index)}
                aria-current={activeIndex === index ? "page" : undefined}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
};

export default GooeyNav;
