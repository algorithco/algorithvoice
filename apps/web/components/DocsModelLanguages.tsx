"use client";

import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

type Model = {
  id: string;
  name: string;
  size: string;
  langs: string[];
  desc: string;
};

const FLAG_MAP: Record<string, string> = {
  en: "us",
  zh: "cn",
  de: "de",
  es: "es",
  ru: "ru",
  ko: "kr",
  fr: "fr",
  ja: "jp",
  pt: "pt",
  tr: "tr",
  pl: "pl",
  ca: "es",
  nl: "nl",
  ar: "sa",
  sv: "se",
  it: "it",
  id: "id",
  hi: "in",
  fi: "fi",
  vi: "vn",
  he: "il",
  uk: "ua",
  el: "gr",
  ms: "my",
  cs: "cz",
  ro: "ro",
  da: "dk",
  hu: "hu",
  ta: "in",
  no: "no",
  th: "th",
  ur: "pk",
  hr: "hr",
  bg: "bg",
  lt: "lt",
  la: "va",
  mi: "nz",
  ml: "in",
  cy: "gb-wls",
  sk: "sk",
  te: "in",
  fa: "ir",
  lv: "lv",
  bn: "bd",
  sr: "rs",
  az: "az",
  sl: "si",
  kn: "in",
  et: "ee",
  mk: "mk",
  br: "fr",
  eu: "es",
  is: "is",
  hy: "am",
  ne: "np",
  mn: "mn",
  bs: "ba",
  kk: "kz",
  sq: "al",
  sw: "ke",
  gl: "es",
  mr: "in",
  pa: "in",
  si: "lk",
  km: "kh",
  sn: "zw",
  yo: "ng",
  so: "so",
  af: "za",
  oc: "fr",
  ka: "ge",
  be: "by",
  tg: "tj",
  sd: "pk",
  gu: "in",
  am: "et",
  yi: "il",
  lo: "la",
  uz: "uz",
  fo: "fo",
  ht: "ht",
  ps: "af",
  tk: "tm",
  nn: "no",
  mt: "mt",
  sa: "in",
  lb: "lu",
  my: "mm",
  bo: "cn",
  tl: "ph",
  mg: "mg",
  as: "in",
  tt: "ru",
  haw: "us",
  ln: "cd",
  ha: "ng",
  ba: "ru",
  jw: "id",
  su: "id",
};

function getFlag(code: string): string {
  return FLAG_MAP[code] ?? code.slice(0, 2).toLowerCase();
}

let _displayNames: Intl.DisplayNames | null = null;
function getLangName(code: string): string {
  try {
    if (!_displayNames && typeof Intl !== "undefined") {
      _displayNames = new Intl.DisplayNames(["en"], { type: "language" });
    }
    const n = _displayNames?.of(code);
    if (n) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch {}
  return code;
}

const MODELS: Model[] = [
  {
    id: "parakeet-tdt-0.6b-v3",
    name: "Parakeet TDT 0.6B v3",
    size: "~670 MB",
    desc: "Default • 25 EU langs • balanced speed/accuracy",
    langs: [
      "bg",
      "hr",
      "cs",
      "da",
      "nl",
      "en",
      "et",
      "fi",
      "fr",
      "de",
      "el",
      "hu",
      "it",
      "lv",
      "lt",
      "mt",
      "pl",
      "pt",
      "ro",
      "sk",
      "sl",
      "es",
      "sv",
      "ru",
      "uk",
    ],
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    size: "~375 MB",
    desc: "99 langs • fastest whisper",
    langs: [
      "en",
      "zh",
      "de",
      "es",
      "ru",
      "ko",
      "fr",
      "ja",
      "pt",
      "tr",
      "pl",
      "ca",
      "nl",
      "ar",
      "sv",
      "it",
      "id",
      "hi",
      "fi",
      "vi",
      "he",
      "uk",
      "el",
      "ms",
      "cs",
      "ro",
      "da",
      "hu",
      "ta",
      "no",
      "th",
      "ur",
      "hr",
      "bg",
      "lt",
      "la",
      "mi",
      "ml",
      "cy",
      "sk",
      "te",
      "fa",
      "lv",
      "bn",
      "sr",
      "az",
      "sl",
      "kn",
      "et",
      "mk",
      "br",
      "eu",
      "is",
      "hy",
      "ne",
      "mn",
      "bs",
      "kk",
      "sq",
      "sw",
      "gl",
      "mr",
      "pa",
      "si",
      "km",
      "sn",
      "yo",
      "so",
      "af",
      "oc",
      "ka",
      "be",
      "tg",
      "sd",
      "gu",
      "am",
      "yi",
      "lo",
      "uz",
      "fo",
      "ht",
      "ps",
      "tk",
      "nn",
      "mt",
      "sa",
      "lb",
      "my",
      "bo",
      "tl",
      "mg",
      "as",
      "tt",
      "haw",
      "ln",
      "ha",
      "ba",
      "jw",
      "su",
    ],
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    size: "~1.0 GB",
    desc: "99 langs • turbo • best speed/quality",
    langs: [
      "en",
      "zh",
      "de",
      "es",
      "ru",
      "ko",
      "fr",
      "ja",
      "pt",
      "tr",
      "pl",
      "ca",
      "nl",
      "ar",
      "sv",
      "it",
      "id",
      "hi",
      "fi",
      "vi",
      "he",
      "uk",
      "el",
      "ms",
      "cs",
      "ro",
      "da",
      "hu",
      "ta",
      "no",
      "th",
      "ur",
      "hr",
      "bg",
      "lt",
      "la",
      "mi",
      "ml",
      "cy",
      "sk",
      "te",
      "fa",
      "lv",
      "bn",
      "sr",
      "az",
      "sl",
      "kn",
      "et",
      "mk",
      "br",
      "eu",
      "is",
      "hy",
      "ne",
      "mn",
      "bs",
      "kk",
      "sq",
      "sw",
      "gl",
      "mr",
      "pa",
      "si",
      "km",
      "sn",
      "yo",
      "so",
      "af",
      "oc",
      "ka",
      "be",
      "tg",
      "sd",
      "gu",
      "am",
      "yi",
      "lo",
      "uz",
      "fo",
      "ht",
      "ps",
      "tk",
      "nn",
      "mt",
      "sa",
      "lb",
      "my",
      "bo",
      "tl",
      "mg",
      "as",
      "tt",
      "haw",
      "ln",
      "ha",
      "ba",
      "jw",
      "su",
    ],
  },
  {
    id: "whisper-large-v3",
    name: "Whisper Large v3",
    size: "~1.7 GB",
    desc: "99 langs • highest accuracy whisper",
    langs: [
      "en",
      "zh",
      "de",
      "es",
      "ru",
      "ko",
      "fr",
      "ja",
      "pt",
      "tr",
      "pl",
      "ca",
      "nl",
      "ar",
      "sv",
      "it",
      "id",
      "hi",
      "fi",
      "vi",
      "he",
      "uk",
      "el",
      "ms",
      "cs",
      "ro",
      "da",
      "hu",
      "ta",
      "no",
      "th",
      "ur",
      "hr",
      "bg",
      "lt",
      "la",
      "mi",
      "ml",
      "cy",
      "sk",
      "te",
      "fa",
      "lv",
      "bn",
      "sr",
      "az",
      "sl",
      "kn",
      "et",
      "mk",
      "br",
      "eu",
      "is",
      "hy",
      "ne",
      "mn",
      "bs",
      "kk",
      "sq",
      "sw",
      "gl",
      "mr",
      "pa",
      "si",
      "km",
      "sn",
      "yo",
      "so",
      "af",
      "oc",
      "ka",
      "be",
      "tg",
      "sd",
      "gu",
      "am",
      "yi",
      "lo",
      "uz",
      "fo",
      "ht",
      "ps",
      "tk",
      "nn",
      "mt",
      "sa",
      "lb",
      "my",
      "bo",
      "tl",
      "mg",
      "as",
      "tt",
      "haw",
      "ln",
      "ha",
      "ba",
      "jw",
      "su",
    ],
  },
  {
    id: "qwen3-asr-1.7b",
    name: "Qwen3 ASR 1.7B",
    size: "~2.4 GB",
    desc: "5 langs • Qwen • zh/ja/ko focus",
    langs: ["en", "zh", "ja", "ko", "vi"],
  },
  {
    id: "distil-large-v3.5",
    name: "Distil Large v3.5",
    size: "~983 MB",
    desc: "1 lang • English only • distilled",
    langs: ["en"],
  },
];

export function DocsModelLanguages() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter((m) => {
      const hay =
        `${m.id} ${m.name} ${m.langs.join(" ")} ${m.langs.map(getLangName).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const isFocused = query.length > 0;
  return (
    <div className="mt-4">
      <motion.div
        className="w-full"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.label
          className="relative flex w-full items-center"
          whileFocus={{ scale: 1.005 }}
          animate={{ scale: isFocused ? 1.01 : 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          <motion.span
            className="pointer-events-none absolute left-4 text-faint"
            animate={{
              scale: isFocused ? 1.15 : 1,
              rotate: isFocused ? 12 : 0,
            }}
            transition={{ type: "spring", stiffness: 500, damping: 15 }}
          >
            ⌕
          </motion.span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by language or model (e.g. Uzbek, uz, whisper)…"
            className="h-12 w-full rounded-full border border-line bg-white pl-11 pr-4 text-base text-ink placeholder:text-faint focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 dark:bg-black md:h-14 md:text-lg"
          />
        </motion.label>
      </motion.div>

      {/* Model cards with full names + high-quality flags (not emoji) — animated filter */}
      <motion.div layout className="mt-4 grid gap-4 md:grid-cols-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((m) => {
            const isOpen = expanded[m.id] ?? false;
            const visible = isOpen ? m.langs : m.langs.slice(0, 12);
            const hidden = m.langs.length - visible.length;
            return (
              <motion.div
                layout
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="group flex flex-col rounded-lg border border-line bg-white p-4 transition-colors hover:border-ink dark:bg-white/[0.04] dark:hover:border-white/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs font-medium text-ink">
                      {m.id}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {m.name}
                    </p>
                    <p className="mt-1 text-xs text-sub">
                      {m.desc} • {m.size}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink">
                    {m.langs.length} langs
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {visible.map((code) => {
                    const name = getLangName(code);
                    const flag = getFlag(code);
                    const hit =
                      query &&
                      (code.toLowerCase().includes(query.toLowerCase()) ||
                        name.toLowerCase().includes(query.toLowerCase()));
                    return (
                      <span
                        key={code}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-none transition-colors ${hit ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-line bg-surface text-ink"}`}
                      >
                        {/* biome-ignore lint/performance/noImgElement: flagcdn external high-quality SVG flag, not emoji */}
                        <img
                          src={`https://flagcdn.com/w20/${flag}.png`}
                          srcSet={`https://flagcdn.com/w40/${flag}.png 2x`}
                          width={16}
                          height={12}
                          alt=""
                          className="h-3 w-4 rounded-sm object-cover"
                          loading="lazy"
                        />
                        <span>{name}</span>
                        <span className="font-mono text-[11px] opacity-60">
                          {code}
                        </span>
                      </span>
                    );
                  })}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-line bg-transparent px-3.5 text-xs text-sub hover:border-ink hover:text-ink"
                    >
                      +{hidden} more
                    </button>
                  ) : null}
                  {isOpen && m.langs.length > 12 ? (
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-white px-3.5 text-xs text-ink hover:bg-surface dark:bg-black dark:text-white"
                    >
                      Show less
                    </button>
                  ) : null}
                </div>
                {m.id === "qwen3-asr-1.7b" ? (
                  <p className="mt-3 text-xs leading-4 text-faint">
                    Optimized for CJK + English. For EU 25 langs, use Parakeet.
                  </p>
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {filtered.length === 0 ? (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-md border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-sub"
          >
            No model supports “{query}” — try “Uzbek”, “English”, “uz” or
            “whisper”.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
