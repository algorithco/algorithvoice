import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repo =
      process.env.NEXT_PUBLIC_GITHUB_REPO ?? "algorithco/algorithvoice";
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {},
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return NextResponse.json({ release: null }, { status: 200 });
    const json = await res.json();
    return NextResponse.json({
      release: { tag: json.tag_name, assets: json.assets },
    });
  } catch {
    return NextResponse.json({ release: null });
  }
}
