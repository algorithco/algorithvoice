import { redirect } from "next/navigation";

import { getSession } from "../../../lib/dal";
import { ConsentClient } from "./ConsentClient";

function safeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/")) return null;
  try {
    const url = new URL(raw, "http://x");
    if (url.host !== "x") return null;
    return raw;
  } catch {
    return null;
  }
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request: requestId } = await searchParams;

  if (!requestId) {
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4 py-12 sm:px-6">
          <p className="t-cap flex items-center gap-2 text-faint">
            <span className="size-1.5 bg-ink" aria-hidden /> Desktop app authorization
          </p>
          <h1 className="t-h1 mt-3">Invalid request.</h1>
          <div className="mt-8 rounded-[20px] border border-line bg-surface p-6 sm:p-8">
            <p className="t-body text-sub">Missing authorization request. Please start again from the desktop app.</p>
          </div>
        </div>
      </div>
    );
  }

  const session = await getSession();
  if (!session) {
    const next = safeReturnTo(`/oauth2/consent?request=${encodeURIComponent(requestId)}`);
    redirect((next ? `/login?returnTo=${encodeURIComponent(next)}` : "/login") as unknown as Parameters<typeof redirect>[0]);
  }

  const user = session.user;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col justify-center px-4 py-10 sm:px-6 sm:py-16">
        {/* Header — no Home button */}
        <div className="flex items-center gap-2.5">
          <span className="inline-block size-1.5 shrink-0 bg-ink" aria-hidden />
          <p className="t-cap text-faint">Desktop app authorization</p>
        </div>
        <h1 className="t-h1 mt-3 tracking-[-0.02em]">Allow access?</h1>
        <p className="t-body mt-3 max-w-[40ch] text-sub">Connect your desktop app to your Algorithco account in one tap.</p>

        <div className="mt-8 rounded-[20px] border border-line bg-surface p-6 shadow-[0_12px_40px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/[0.05] sm:p-7">
          <ConsentClient requestId={requestId} userEmail={user.email ?? null} />
        </div>

        <p className="mx-auto mt-6 max-w-[36ch] text-center font-mono text-[11px] leading-4 text-faint">
          Algorith Voice Desktop is first-party — your audio stays local unless you choose cloud.
        </p>
      </div>
    </div>
  );
}
