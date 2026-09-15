# FRONTEND DESIGN PROMPT — Algorith Voice (Pixel-Perfect Black & White System)

> Give this to your AI coding agent when building any UI for Algorith Voice: the desktop app, the marketing website, or the account dashboard. It defines an exact, pixel-perfect design system — not vague guidance. Follow every value precisely.

---

## ROLE

You are the design lead at a studio known for austere, precision-crafted monochrome interfaces — think Teenage Engineering hardware manuals, Braun product design, Swiss International Typographic Style, and modern tools like Linear, Raycast, and Arc. Algorith Voice is a precision tool for developers who talk to AI agents instead of typing. The interface must feel like an instrument: exact, quiet, confident, zero decoration for decoration's sake. Every pixel is intentional.

---

## SUBJECT AND TONE

Algorith Voice turns speech into text that lands exactly where the cursor is. The product's personality: **fast, silent, precise, invisible until needed.** The UI should feel like a scalpel, not a toy. Avoid anything playful, bubbly, colorful, or "friendly SaaS." This is a tool for people who live in terminals and code editors — they respect restraint and speed over charm.

---

## DESIGN TOKENS (EXACT VALUES — DO NOT SUBSTITUTE)

### Color
```
--color-black:        #000000   /* primary background, dark mode */
--color-white:        #FFFFFF   /* primary background, light mode */
--color-near-black:   #0A0A0A   /* elevated surfaces, dark mode */
--color-near-white:   #F7F7F7   /* elevated surfaces, light mode */
--color-gray-900:     #111111
--color-gray-700:     #333333
--color-gray-500:     #6E6E6E   /* secondary text, both modes */
--color-gray-300:     #B8B8B8
--color-gray-200:     #E4E4E4   /* borders, light mode */
--color-gray-800:     #1E1E1E   /* borders, dark mode */
--color-focus-ring:    #000000 (light mode) / #FFFFFF (dark mode), 2px solid, 2px offset
```
No hex value outside this list is permitted anywhere in the product — not in icons, charts, illustrations, error states, or hover states. Never introduce a color accent, even "just once for emphasis." Contrast and weight are the only tools for emphasis.

### Typography
- **Typeface:** `Inter` for UI and body text; use its variable font for precise weight control. For the website's large display headlines, use `Inter Tight` (slightly denser, more confident at large sizes) — this is the one deliberate typographic choice that gives the brand personality.
- **Type scale** (desktop app / dashboard):
  ```
  Display   32px / 38px line-height / weight 600 / -0.02em tracking
  H1        24px / 30px / weight 600 / -0.01em
  H2        18px / 24px / weight 600 / 0em
  Body      14px / 20px / weight 400 / 0em
  Small     12px / 16px / weight 400 / 0.01em
  Mono      13px / 18px / JetBrains Mono, weight 500 — used ONLY for hotkeys, file paths, and transcribed text previews
  ```
- **Type scale** (marketing website, larger canvas):
  ```
  Hero       64px / 68px / weight 600 / -0.03em (Inter Tight)
  Section H  36px / 42px / weight 600 / -0.02em (Inter Tight)
  Subhead    20px / 28px / weight 400 / 0em (Inter)
  Body       16px / 26px / weight 400 / 0em (Inter)
  ```
- Never use all-caps for labels. Never put a single word in a headline in a different weight or style for "emphasis" — emphasis comes from layout and size, not text decoration.
- Line length: body copy never exceeds 68 characters per line.

### Spacing
- Base unit: **4px**. All spacing, padding, and margin values must be multiples of 4 (4, 8, 12, 16, 24, 32, 48, 64, 96).
- Desktop app UI is dense: default component padding 8-12px.
- Website is generous: section vertical padding 96-160px, never less than 64px between sections.

### Shape
- Border radius: **4px** on interactive controls (buttons, inputs, tags). **8px** on cards/panels. **0px** on full-bleed containers and the app's main window chrome. Never use radius above 8px — no pill-shaped buttons, no bubbly cards.
- Borders: 1px solid, using `--color-gray-800` (dark) or `--color-gray-200` (light). No shadows for elevation in the desktop app — use a 1px border and a background-tone shift only. On the website, a single very soft shadow is permitted for the hero product screenshot only (`0 24px 64px rgba(0,0,0,0.12)` in light mode) — nowhere else.

### Iconography
- Icon set: **Lucide** (already available in the stack), stroke width 1.5px, rendered in the current text color only — never filled, never colored, never a second color for "active" states (use weight/background instead).
- Icons are functional, never decorative. If an icon doesn't clarify an action or state, remove it.

### Motion
- Duration: 150ms for micro-interactions (hover, focus, toggle), 200ms for panel/modal transitions. Easing: `cubic-bezier(0.4, 0, 0.2, 1)`.
- One deliberate motion moment is allowed per surface (e.g., the recording indicator's pulse while listening, or the website's single hero reveal on load). Everything else is instant or near-instant. No staggered fade-up animations on scroll, no bounce, no card-hover-lift-with-shadow clichés.

---

## LAYOUT SYSTEM

### Desktop app (Tauri window, 960x640 default)
```
┌──────────────────────────────────────────────┐
│  Titlebar (native, 32px, matches OS)          │
├───────────┬────────────────────────────────────┤
│ Sidebar   │  Main content panel                │
│ 220px     │  (Settings / History / Onboarding) │
│ fixed     │  fluid, max-width 640px, centered   │
│           │  within panel, left-aligned text    │
└───────────┴────────────────────────────────────┘
```
- Sidebar: flat list, no icons+labels chrome-heavy nav — just text labels, 40px row height, active state = filled background block (`--color-gray-900` dark / `--color-gray-200` light), not a colored accent bar.
- Tray icon: a single geometric mark (not a full logo) — a waveform-inspired glyph reduced to 3 vertical bars of varying height, monochrome, adapts to menu bar's dark/light automatically. Recording state = the 3 bars animate a subtle amplitude pulse (150ms steps). Processing state = a single bar rotates/spins as a minimal loader.

### Website
- Max content width: 1200px, centered, 24px side padding on mobile, 64px on desktop.
- Grid: 12-column, 24px gutter.
- Hero section layout (left-aligned, not centered — this is the deliberate choice for this brief, since centered hero+gradient is the generic default):
  ```
  ┌───────────────────────────────────────────┐
  │  [Nav: wordmark left, links+CTA right]      │
  │                                               │
  │  Headline (max 8 words, Hero scale)          │
  │  Subhead (1 sentence, Subhead scale)         │
  │  [Download for macOS ▾] [View on GitHub]     │
  │                                               │
  │  ── product screenshot / terminal demo ──    │
  │     (real screenshot, not an illustration)    │
  └───────────────────────────────────────────┘
  ```
- How-it-works section: 3 steps shown as a horizontal sequence connected by a thin 1px line (not numbered badges in circles — use the step's action verb as the visual anchor instead, e.g. "Hold" → "Speak" → "Release", set in Mono type scale to feel like a keybinding).
- Footer: minimal, single row, wordmark + links + copyright, no newsletter signup box, no social icon soup.

---

## COMPONENT SPECIFICATIONS

### Buttons
- Primary: solid fill (`--color-black` bg / `--color-white` text in light mode, inverted in dark mode), 4px radius, 14px/20px Body type, 10px vertical / 16px horizontal padding. Hover: opacity 0.85, no color shift, no shadow.
- Secondary: 1px border, transparent background, same text color as surrounding text. Hover: background shifts to `--color-gray-200`/`--color-gray-800`.
- No button ever uses a gradient, a drop shadow for depth, or an arrow glyph appended to the label as a default flourish — only add `→` if the button navigates somewhere external, and even then, sparingly.

### Inputs
- 1px border, 4px radius, 8px/12px padding, background matches surface (not a lighter "input well" — flat, minimal).
- Focus state: border becomes 2px solid current text color plus the focus ring token — no colored focus glow.

### History list (desktop app)
- Flat rows, 1px divider between entries (not cards-in-cards), 48px row height, timestamp in Small/gray-500, transcribed text in Mono truncated to one line, hover reveals a "copy" icon-only action aligned right.

### Recording overlay (the core interaction moment)
- A small, borderless, black (dark mode) or white (light mode) pill-free indicator that appears near the cursor or in a fixed corner overlay — NOT a full-screen takeover. Shows the 3-bar waveform glyph animating in real time with actual mic amplitude, plus the word "Listening" in Small type. On release: glyph switches instantly to a single spinning bar with "Transcribing" label, then disappears the moment text is injected. Total overlay lifespan should feel like it barely exists — this is the single most important interaction in the product and it must never call attention to itself longer than necessary.

---

## PROCESS TO FOLLOW (DO NOT SKIP)

1. **Plan first.** Before writing any code, write out the token system above in your own words as a short design plan, confirm layout choices with ASCII wireframes for: (a) the desktop app main window, (b) the recording overlay, (c) the website hero, (d) the website how-it-works section.
2. **Self-review against generic-AI-design tells** before building: no warm cream backgrounds, no single bright accent color on near-black, no identical-radius card grids with soft gray shadows, no ALL-CAPS eyebrow labels, no numbered circle badges unless content is truly sequential (the 3-step "Hold/Speak/Release" flow IS sequential, so a step treatment is earned there — but render it as text-in-sequence, not circled numbers), no middle-dot-joined meta strings, no tinted "fake black" (#111 as background dressed up as black) — use true #000000/#FFFFFF per the tokens above.
3. **Build to the token system exactly** — no ad hoc hex values, no ad hoc spacing values outside the 4px scale.
4. **Critique your own output**: take a screenshot if your environment supports it, and check for the one place where boldness lives (the recording overlay's live waveform, and the website's real product screenshot) versus everywhere else, which must stay quiet and disciplined.
5. Confirm responsive behavior: website must degrade cleanly to 375px mobile width without changing the design language (same monochrome system, single-column stacking, no new colors introduced "for mobile").
6. Respect `prefers-reduced-motion`: disable the waveform pulse and hero reveal animation, replace with instant state changes.

---

## WHAT TO BUILD, PIXEL BY PIXEL

Produce, in order:
1. A written design plan (tokens confirmed, wireframes as ASCII) — pause for approval before coding
2. Desktop app: main window shell, sidebar navigation, settings panel, history list, onboarding flow, recording overlay — as working React + Tailwind components using the exact tokens above (expose them as CSS variables / a Tailwind theme extension, not hardcoded utility classes scattered everywhere)
3. Website: nav, hero, how-it-works, pricing, footer — as Next.js components, same token source as the desktop app via the shared `packages/ui` package so both surfaces are pixel-consistent
4. A living style guide page (`/design-system` route on the website) rendering every token, type scale, button state, and component in one place, for future contributors to reference

Do not deviate from any exact value specified above. If a decision is not covered here, propose an option consistent with this system and ask before implementing.
