import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../../../components/AuthShell";
import { Reveal } from "../../../components/Reveal";
import { getSession } from "../../../lib/dal";

const API = process.env.API_URL ?? "http://localhost:3001";

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
      <Reveal>
        <AuthShell
          title="Invalid request."
          subtitle="OAuth consent"
          footer={
            <Link href="/" className="underline hover:text-ink">
              Home
            </Link>
          }
        >
          <p className="text-sm text-muted-foreground">
            Missing authorization request. Please start again from the desktop
            app.
          </p>
        </AuthShell>
      </Reveal>
    );
  }
  const session = await getSession();
  if (!session) {
    const next = safeReturnTo(
      `/oauth2/consent?request=${encodeURIComponent(requestId)}`,
    );
    redirect(
      (next
        ? `/login?returnTo=${encodeURIComponent(next)}`
        : "/login") as unknown as Parameters<typeof redirect>[0],
    );
  }
  const user = session.user;

  async function act(formData: FormData) {
    "use server";
    const approved = formData.get("approved") === "true";
    const cookieStore = await cookies();
    const token = cookieStore.get("__Host-av_at")?.value;
    if (!token) redirect("/login" as unknown as Parameters<typeof redirect>[0]);
    const res = await fetch(`${API}/oauth2/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id: requestId, approved }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      redirect_to?: string;
    };
    if (body.redirect_to)
      redirect(body.redirect_to as unknown as Parameters<typeof redirect>[0]);
    redirect("/" as unknown as Parameters<typeof redirect>[0]);
  }

  return (
    <Reveal>
      <AuthShell
        title="Allow access?"
        subtitle="Desktop app authorization"
        footer={
          <Link href="/" className="underline hover:text-ink">
            Home
          </Link>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="break-words text-sm">
            <span className="font-semibold">Algorith Voice Desktop</span> wants
            to access your account
            {user.email ? ` (${user.email})` : ""}.
          </p>
          <p className="text-xs text-muted-foreground">
            This is your own first-party desktop app. No third party receives
            your data. Scopes: profile, email
            {/* offline_access enables stay-signed-in */}.
          </p>
          <form action={act} className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              name="approved"
              value="true"
              className="min-h-[44px] rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Allow
            </button>
            <button
              type="submit"
              name="approved"
              value="false"
              className="min-h-[44px] rounded-md border px-5 py-2.5 text-sm"
            >
              Deny
            </button>
          </form>
        </div>
      </AuthShell>
    </Reveal>
  );
}
