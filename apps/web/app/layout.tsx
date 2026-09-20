import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://algorithvoice.com"),
  title: {
    default: "Algorith Voice — talk faster, type never",
    template: "%s | Algorith Voice",
  },
  description:
    "Push-to-talk dictation for macOS, Windows, Linux. Local mode = audio never leaves your device.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Black theme only — no light mode, no theme switcher.
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
