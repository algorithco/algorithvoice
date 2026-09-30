import { NextResponse } from "next/server";

export const revalidate = 21_600;

export async function GET() {
  try {
    const repo =
      process.env.NEXT_PUBLIC_GITHUB_REPO ?? "algorithco/algorithvoice-app";
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {},
        next: { revalidate: 21_600 },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return NextResponse.json({ release: null }, { status: 200 });
    const json = (await res.json()) as {
      tag_name?: unknown;
      assets?: unknown;
    };
    if (typeof json.tag_name !== "string" || !Array.isArray(json.assets)) {
      return NextResponse.json({ release: null });
    }
    return NextResponse.json({
      release: { tag: json.tag_name, assets: json.assets },
    });
  } catch {
    return NextResponse.json({ release: null });
  }
}
