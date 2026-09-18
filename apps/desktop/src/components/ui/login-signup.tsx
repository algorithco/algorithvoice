"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Particles from "@/components/Particles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { loginDemo, type SessionInfo, signInDesktop } from "@/lib/session";

type Props = {
  onDone: (s: SessionInfo) => void;
};

export default function LoginCardSection({ onDone }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleContinue = async () => {
    setError(null);
    setBusy(true);
    try {
      const s = await signInDesktop();
      onDone(s);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sign in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = async () => {
    setError(null);
    try {
      const s = await loginDemo();
      onDone(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo sign-in failed.");
    }
  };

  return (
    <section className="fixed inset-0 overflow-auto bg-black text-white">
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <Particles
          particleCount={260}
          particleSpread={10}
          speed={0.08}
          particleBaseSize={90}
          sizeRandomness={0.9}
          alphaParticles
          moveParticlesOnHover
          particleHoverFactor={0.8}
          disableRotation={false}
          cameraDistance={20}
          pixelRatio={
            typeof window !== "undefined"
              ? Math.min(window.devicePixelRatio || 1, 2)
              : 1
          }
        />
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 10,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            position: "relative",
            zIndex: 10,
          }}
        >
          <Card
            style={{
              background: "#000000",
              borderColor: "rgba(255,255,255,0.10)",
              borderWidth: 1,
            }}
            className="w-full bg-black border-white/10 shadow-none"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <CardHeader className="space-y-2 pb-6">
                <CardTitle className="text-[28px] font-semibold tracking-tight text-white">
                  Welcome back
                </CardTitle>
                <CardDescription className="text-[13px] leading-relaxed text-white/60">
                  Continue with Algorith Voice — you’ll be redirected to
                  <span className="text-white"> algorithvoice.com </span>
                  to sign in securely.
                </CardDescription>
              </CardHeader>
            </motion.div>

            <CardContent className="grid gap-6">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="grid gap-3"
              >
                <Button
                  className="h-[46px] w-full rounded-xl border border-white/15 bg-black text-[14px] font-medium tracking-wide text-white hover:bg-white/[0.06] hover:border-white/20 hover:text-white transition-all"
                  onClick={handleContinue}
                  disabled={busy}
                >
                  {busy ? "Opening browser…" : "Continue with Algorith Voice"}
                </Button>
                <p className="text-center text-[11px] leading-none text-white/35">
                  Secure OAuth 2.0 • PKCE • No password in the app
                </p>
              </motion.div>

              <AnimatePresence>
                {error ? (
                  <motion.p
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                    className="text-sm text-red-400 text-center bg-red-950/20 border border-red-900/30 rounded-lg py-2.5 px-3"
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.45 }}
                className="relative"
              >
                <Separator className="bg-white/10" />
                <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-black px-3 text-[11px] uppercase tracking-widest text-white/30">
                  or
                </span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.52 }}
              >
                <Button
                  variant="outline"
                  className="h-[46px] w-full rounded-xl border border-white/10 bg-black text-[14px] font-medium text-white hover:bg-white/[0.04] hover:border-white/15 hover:text-white transition-all"
                  onClick={handleDemo}
                  disabled={busy}
                >
                  Continue as demo — no backend needed
                </Button>
                <p className="mt-2.5 text-center text-[11px] text-white/30">
                  demo@algorithvoice.local · local-only session
                </p>
              </motion.div>
            </CardContent>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <CardFooter className="flex flex-col items-center gap-3 pb-8 pt-2">
                <p className="text-center text-xs leading-relaxed text-white/35">
                  By continuing, you agree to our Terms and Privacy Policy.
                  <br />
                  Your browser will open to complete sign-in.
                </p>
                <a
                  href="https://algorithvoice.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] tracking-[0.14em] text-white/20 transition-colors hover:text-white/40 uppercase"
                >
                  algorithvoice.com
                </a>
              </CardFooter>
            </motion.div>
          </Card>
        </div>
      </div>
    </section>
  );
}
