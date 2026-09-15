import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://algorithvoice.com"),
  title: {
    default: "Algorith Voice — hold to talk, release to type",
    template: "%s | Algorith Voice",
  },
  description:
    "Push-to-talk dictation for macOS, Windows, Linux. Local mode = audio never leaves your device.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
