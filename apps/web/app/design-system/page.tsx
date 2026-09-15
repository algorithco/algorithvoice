"use client";

import {
  Badge,
  Button,
  Card,
  HistoryList,
  Input,
  RecordingOverlay,
  Sidebar,
  WaveformGlyph,
} from "@algorith-voice/ui";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

// Living style guide: every token, type step, button state, and component
// in one place for future contributors. Monochrome only, by construction.
const SWATCHES = [
  ["--color-black", "#000000"],
  ["--color-white", "#FFFFFF"],
  ["--color-near-black", "#0A0A0A"],
  ["--color-near-white", "#F7F7F7"],
  ["--color-gray-900", "#111111"],
  ["--color-gray-800", "#1E1E1E"],
  ["--color-gray-700", "#333333"],
  ["--color-gray-500", "#6E6E6E"],
  ["--color-gray-300", "#B8B8B8"],
  ["--color-gray-200", "#E4E4E4"],
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
      <h2 className="av-h1">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
      <SiteNav />
      <main className="mx-auto max-w-[1200px] px-6 py-24 md:px-16 md:py-32">
        <h1 className="av-section-h">Design system</h1>
        <p className="av-body-lg av-prose mt-4 text-gray-500">
          The exact tokens every surface is built from. No value outside this
          page is permitted in the product.
        </p>

        <Section title="Color">
          <ul className="grid gap-px border border-gray-200 bg-gray-200 sm:grid-cols-2 dark:border-gray-800 dark:bg-gray-800">
            {SWATCHES.map(([name, hex]) => (
              <li
                key={name}
                className="flex items-center gap-4 bg-white p-4 dark:bg-black"
              >
                <span
                  className="h-8 w-8 shrink-0 border border-gray-200 dark:border-gray-800"
                  style={{ backgroundColor: hex }}
                />
                <span className="av-mono">{name}</span>
                <span className="av-small ml-auto text-gray-500">{hex}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Type scale">
          <div className="flex flex-col gap-6 border border-gray-200 p-8 dark:border-gray-800">
            <p className="av-hero">Hero 64/68 Inter Tight</p>
            <p className="av-section-h">Section 36/42 Inter Tight</p>
            <p className="av-display">Display 32/38</p>
            <p className="av-h1">Heading 24/30</p>
            <p className="av-h2">Subhead 18/24</p>
            <p className="av-body">
              Body 14/20 — the quick brown fox jumps over the lazy dog.
            </p>
            <p className="av-small">
              Small 12/16 — secondary text and captions.
            </p>
            <p className="av-mono">
              Mono 13/18 — hotkeys, paths, transcripts only.
            </p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Inputs">
          <div className="max-w-[640px]">
            <Input placeholder="Type here, then tab to see the focus ring" />
          </div>
        </Section>

        <Section title="Surfaces">
          <div className="flex flex-wrap items-center gap-3">
            <Card className="p-6">
              <p className="av-body">Card, 8px radius</p>
            </Card>
            <Badge>Badge</Badge>
            <WaveformGlyph className="text-black dark:text-white" />
          </div>
        </Section>

        <Section title="Sidebar">
          <div className="max-w-[220px] border border-gray-200 dark:border-gray-800">
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

        <Section title="History rows">
          <div className="border border-gray-200 dark:border-gray-800">
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

        <Section title="Recording overlay">
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
