"use client";

import {
  Badge,
  Button,
  Card,
  HistoryList,
  Input,
  Logo,
  RecordingOverlay,
  Sidebar,
  WaveformGlyph,
} from "@algorith-voice/ui";
import Link from "next/link";
import { Counter } from "../../components/Counter";
import { Faq } from "../../components/Faq";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

// Living style guide: V5 tokens + type scale for the website, plus the shared
// desktop component truth. Monochrome only, by construction.
const SWATCHES: [string, string][] = [
  ["--v5-bg (background)", "var(--v5-bg)"],
  ["--v5-surface (surface)", "var(--v5-surface)"],
  ["--v5-raised (surface-raised)", "var(--v5-raised)"],
  ["--v5-border (border)", "var(--v5-border)"],
  ["--v5-t1 (text-primary)", "var(--v5-t1)"],
  ["--v5-t2 (text-secondary)", "var(--v5-t2)"],
  ["--v5-t3 (text-tertiary)", "var(--v5-t3)"],
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16">
      <h2 className="t-cap text-faint">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-24 md:px-16 md:py-32">
        <p className="t-cap text-faint">Design system</p>
        <h1 className="t-h1 mt-4">Tokens, type, motion.</h1>
        <p className="t-body mt-4 max-w-[68ch] text-sub">
          V5 for the website. No value outside this page is permitted in the
          product.
        </p>

        <Section title="Color">
          <ul className="grid gap-px rounded-lg border border-line bg-line sm:grid-cols-2">
            {SWATCHES.map(([name, value]) => (
              <li key={name} className="flex items-center gap-4 bg-canvas p-4">
                <span
                  className="h-8 w-8 shrink-0 rounded-md border border-line"
                  style={{ backgroundColor: value }}
                />
                <span className="font-mono text-[13px] leading-[18px] font-medium">
                  {name}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Type — Inter, mono accents only">
          <div className="flex min-w-0 flex-col gap-6 overflow-hidden rounded-lg border border-line bg-surface p-6 sm:p-8">
            <p className="t-hero">Hero fluid</p>
            <p className="t-h1">H1 fluid</p>
            <p className="t-h2">H2 fluid</p>
            <p className="t-lead">
              Body large 18/28 — the quick brown fox jumps over the lazy dog.
            </p>
            <p className="t-body">Body 16/24 — secondary copy and answers.</p>
            <p className="t-cap">Caption 13/18 — uppercase labels only</p>
            <p className="font-mono text-[13px] leading-[18px] font-medium">
              Mono 13/18 — hotkeys, code, versions only.
            </p>
          </div>
        </Section>

        <Section title="Buttons — 6px radius">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/download" className="btn btn-primary">
              Primary
            </Link>
            <Link href="/docs" className="btn btn-secondary">
              Secondary →
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button>Desktop primary</Button>
            <Button variant="secondary">Desktop secondary</Button>
            <Button variant="ghost">Desktop ghost</Button>
          </div>
        </Section>

        <Section title="Motion specimens">
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-line bg-surface p-6 sm:gap-8 sm:p-8">
            <p className="t-h2">
              <Counter to={42} />
            </p>
            <div className="w-full min-w-0 sm:max-w-[320px] sm:flex-1">
              <Faq
                items={[["Sample question?", "Sample answer in body copy."]]}
              />
            </div>
          </div>
        </Section>

        <Section title="Brand mark + indicator (desktop truth)">
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-line bg-surface p-6 sm:p-8">
            <Logo className="h-6 w-auto text-ink" />
            <WaveformGlyph className="text-ink" />
            <Badge>Badge</Badge>
          </div>
        </Section>

        <Section title="Inputs (desktop truth)">
          <div className="max-w-[640px]">
            <Input placeholder="Type here, then tab to see the focus ring" />
          </div>
        </Section>

        <Section title="Surfaces (desktop truth)">
          <div className="flex flex-wrap items-center gap-3">
            <Card className="p-6">
              <p className="t-body">Card, 8px radius</p>
            </Card>
          </div>
        </Section>

        <Section title="Sidebar (desktop truth)">
          <div className="max-w-[220px] rounded-lg border border-line">
            <Sidebar
              items={[
                { id: "dictate", label: "Dictate" },
                { id: "history", label: "History" },
                { id: "settings", label: "Settings" },
              ]}
              active="history"
              onSelect={() => {}}
            />
          </div>
        </Section>

        <Section title="History rows (desktop truth)">
          <div className="rounded-lg border border-line">
            <HistoryList
              entries={[
                {
                  id: "1",
                  createdAt: "09:41",
                  transcript: "Refactor the auth middleware first.",
                },
                {
                  id: "2",
                  createdAt: "09:12",
                  transcript: "Index the usage records table.",
                },
              ]}
              onCopy={() => {}}
            />
          </div>
        </Section>

        <Section title="Recording overlay (desktop truth)">
          <div className="flex flex-wrap gap-4">
            <RecordingOverlay state="listening" />
            <RecordingOverlay state="transcribing" />
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}
