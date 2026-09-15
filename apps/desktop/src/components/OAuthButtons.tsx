import { Button } from "@algorith-voice/ui";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import {
  OAUTH_PROVIDERS,
  type OAuthProvider,
  oauthProviderLabel,
  type SessionInfo,
  signInWithOAuth,
} from "../lib/session.js";

// OAuth entry points. Opens the provider in the system browser; the
// backend redirects to algorithvoice:// and the Rust shell forwards the
// callback to complete the session — no secrets touch this view.
export function OAuthButtons({ onDone }: { onDone: (s: SessionInfo) => void }) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const start = async (provider: OAuthProvider) => {
    if (pending) return;
    cancelled.current = false;
    setPending(provider);
    setError(null);
    try {
      const session = await signInWithOAuth(provider);
      if (!cancelled.current) onDone(session);
    } catch (e) {
      if (!cancelled.current) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      if (!cancelled.current) setPending(null);
    }
  };

  const cancel = () => {
    cancelled.current = true;
    setPending(null);
  };

  return (
    <div>
      <div className="flex flex-col gap-2">
        {OAUTH_PROVIDERS.map((provider) => (
          <Button
            key={provider}
            variant="secondary"
            onClick={() => void start(provider)}
            disabled={pending !== null}
            className="gap-2"
          >
            {pending === provider ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <ExternalLink size={16} strokeWidth={1.5} />
            )}
            Continue with {oauthProviderLabel(provider)}
          </Button>
        ))}
      </div>
      {pending ? (
        <div className="mt-3 flex items-center gap-3">
          <p className="av-small text-gray-500">
            Waiting for the browser — complete sign-in there, then return here.
          </p>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error && !pending ? (
        <p className="av-small mt-3 text-gray-500">{error}</p>
      ) : null}
    </div>
  );
}
