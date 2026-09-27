import { Button } from "@algorith-voice/ui";
import { useRef, useState } from "react";
import { signInDesktop } from "../lib/session/auth.js";
import type { SessionInfo } from "../lib/session/types.js";
import { Loader } from "./animate-ui/icons/loader.js";
import { LogIn } from "./animate-ui/icons/log-in.js";

// OAuth entry point. The first-party authorization server opens in the
// system browser and returns only a short-lived code to the app. Tokens are
// obtained later through PKCE and never travel in the callback URL.
export function OAuthButtons({ onDone }: { onDone: (s: SessionInfo) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    if (pending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    setError(null);
    try {
      const session = await signInDesktop({ signal: controller.signal });
      if (!controller.signal.aborted) onDone(session);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPending(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div>
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={() => void start()}
          disabled={pending}
          className="gap-2"
        >
          {pending ? (
            <Loader size={16} animation="spin" animate />
          ) : (
            <LogIn size={16} animateOnHover />
          )}
          Continue securely
        </Button>
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
