"use client";

import {
  ArrowRight,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  Lock,
  Mail,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  login,
  type SessionInfo,
  signInWithOAuth,
  signup,
} from "@/lib/session";

type Props = {
  onDone: (s: SessionInfo) => void;
};

export default function LoginCardSection({ onDone }: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthPending, setOauthPending] = useState<"google" | "github" | null>(
    null,
  );

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "signup" && password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s =
        mode === "signup"
          ? await signup(email.trim(), password, "Desktop")
          : await login(email.trim(), password);
      onDone(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    setOauthPending(provider);
    setError(null);
    try {
      const s = await signInWithOAuth(provider);
      onDone(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OAuth failed.");
    } finally {
      setOauthPending(null);
    }
  };

  return (
    <section className="fixed inset-0 overflow-hidden bg-black text-zinc-50">
      {/* Particles background — OGL points, much lighter than PixelSnow ray-march */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, ease: [0.22, 0.61, 0.36, 1] }}
        className="absolute inset-0"
        aria-hidden
      >
        <Particles
          particleCount={160}
          particleSpread={9}
          speed={0.06}
          particleColors={["#ffffff"]}
          moveParticlesOnHover={false}
          alphaParticles={true}
          particleBaseSize={72}
          sizeRandomness={0.7}
          cameraDistance={18}
          disableRotation={false}
          pixelRatio={Math.min(window.devicePixelRatio ?? 1, 1.25)}
          className="h-full w-full opacity-80"
        />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.2 }}
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60"
      />
      <div className="absolute inset-0 pointer-events-none [background:radial-gradient(85%_70%_at_50%_35%,rgba(255,255,255,0.04),transparent_65%)]" />

      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
        className="absolute left-0 right-0 top-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 backdrop-blur-sm"
      >
        <motion.span
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-xs tracking-[0.14em] uppercase text-zinc-400"
        >
          Algorith Voice
        </motion.span>
        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            variant="outline"
            className="h-9 rounded-lg border-zinc-800 bg-zinc-900 text-zinc-50 hover:bg-zinc-800 hover:text-white transition-colors"
            onClick={() => window.open("https://algorithvoice.com", "_blank")}
          >
            <span className="mr-2">Contact</span>
            <motion.span
              animate={{ x: [0, 3, 0] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                repeatDelay: 2,
                ease: "easeInOut",
              }}
              className="inline-flex"
            >
              <ArrowRight className="h-4 w-4" />
            </motion.span>
          </Button>
        </motion.div>
      </motion.header>

      <div className="h-full w-full grid place-items-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            duration: 0.8,
            delay: 0.35,
            ease: [0.22, 0.61, 0.36, 1],
          }}
          className="w-full max-w-sm"
        >
          <Card className="w-full border-zinc-800 bg-zinc-900/70 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/60 shadow-2xl shadow-black/50">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <CardHeader className="space-y-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={mode}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
                  >
                    <CardTitle className="text-2xl">
                      {mode === "login" ? "Welcome back" : "Create account"}
                    </CardTitle>
                    <CardDescription className="text-zinc-400 mt-1.5">
                      {mode === "login"
                        ? "Sign in to sync devices and use cloud transcription."
                        : "Create an account to sync devices and use cloud transcription."}
                    </CardDescription>
                  </motion.div>
                </AnimatePresence>
              </CardHeader>
            </motion.div>

            <CardContent className="grid gap-5">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.58 }}
                className="grid gap-2"
              >
                <Label htmlFor="email" className="text-zinc-300">
                  Email
                </Label>
                <div className="relative group">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-zinc-300" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 bg-zinc-950 border-zinc-800 text-zinc-50 placeholder:text-zinc-600 focus-visible:border-zinc-700 focus-visible:ring-zinc-700/30 transition-all"
                  />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.66 }}
                className="grid gap-2"
              >
                <Label htmlFor="password" className="text-zinc-300">
                  Password
                </Label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-zinc-300" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={
                      mode === "signup" ? "•••••••• (12+ chars)" : "••••••••"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 bg-zinc-950 border-zinc-800 text-zinc-50 placeholder:text-zinc-600 focus-visible:border-zinc-700 focus-visible:ring-zinc-700/30 transition-all"
                  />
                  <motion.button
                    type="button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-zinc-400 hover:text-zinc-200"
                    onClick={() => setShowPassword((v) => !v)}
                    whileTap={{ scale: 0.92 }}
                    whileHover={{ scale: 1.05 }}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={String(showPassword)}
                        initial={{ opacity: 0, rotate: -15, scale: 0.8 }}
                        animate={{ opacity: 1, rotate: 0, scale: 1 }}
                        exit={{ opacity: 0, rotate: 15, scale: 0.8 }}
                        transition={{ duration: 0.18 }}
                        className="inline-flex"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.74 }}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    className="border-zinc-700 data-[state=checked]:bg-zinc-50 data-[state=checked]:text-zinc-900"
                  />
                  <Label
                    htmlFor="remember"
                    className="text-zinc-400 cursor-pointer"
                  >
                    Remember me
                  </Label>
                </div>
                <motion.a
                  href="/"
                  className="text-sm text-zinc-300 hover:text-zinc-100"
                  whileHover={{ x: 1 }}
                  transition={{ type: "spring", stiffness: 400 }}
                >
                  Forgot password?
                </motion.a>
              </motion.div>

              <AnimatePresence>
                {error ? (
                  <motion.p
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
                    className="text-sm text-red-400 text-center bg-red-950/30 border border-red-900/50 rounded-md py-2 px-3"
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.8 }}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
              >
                <Button
                  className="w-full h-10 rounded-lg bg-zinc-50 text-zinc-900 hover:bg-white shadow-lg shadow-black/20 hover:shadow-xl hover:shadow-black/30 transition-all"
                  onClick={submit}
                  disabled={
                    busy ||
                    !email ||
                    (mode === "signup" ? password.length < 12 : !password) ||
                    !!oauthPending
                  }
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={busy ? "busy" : mode}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                      className="inline-flex items-center"
                    >
                      {busy
                        ? "Please wait..."
                        : mode === "login"
                          ? "Sign in"
                          : "Create account"}
                    </motion.span>
                  </AnimatePresence>
                </Button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.86 }}
                className="relative"
              >
                <Separator className="bg-zinc-800" />
                <span className="absolute left-1/2 -translate-x-1/2 -top-3 bg-zinc-900/70 px-2 text-[11px] uppercase tracking-widest text-zinc-500 backdrop-blur">
                  or
                </span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.92 }}
                className="grid grid-cols-2 gap-3"
              >
                <motion.div
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-lg border-zinc-800 bg-zinc-950 text-zinc-50 hover:bg-zinc-900 hover:border-zinc-700 hover:text-white transition-all"
                    onClick={() => handleOAuth("github")}
                    disabled={!!oauthPending || busy}
                  >
                    <GitBranch className="h-4 w-4 mr-2" />
                    {oauthPending === "github" ? "..." : "GitHub"}
                  </Button>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Button
                    variant="outline"
                    className="h-10 w-full rounded-lg border-zinc-800 bg-zinc-950 text-zinc-50 hover:bg-zinc-900 hover:border-zinc-700 hover:text-white transition-all"
                    onClick={() => handleOAuth("google")}
                    disabled={!!oauthPending || busy}
                  >
                    <Globe className="h-4 w-4 mr-2" />
                    {oauthPending === "google" ? "..." : "Google"}
                  </Button>
                </motion.div>
              </motion.div>
            </CardContent>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.98 }}
            >
              <CardFooter className="flex flex-col items-center gap-3 text-sm text-zinc-400">
                <div>
                  {mode === "login"
                    ? "New to Algorith Voice?"
                    : "Already have an account?"}
                  <motion.button
                    type="button"
                    className="ml-1 text-zinc-200 hover:text-white hover:underline underline-offset-4"
                    onClick={() => {
                      setMode((m) => (m === "login" ? "signup" : "login"));
                      setError(null);
                    }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {mode === "login" ? "Create account" : "Sign in"}
                  </motion.button>
                </div>
                <motion.a
                  href="https://algorithvoice.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] tracking-wide text-zinc-600 transition-colors hover:text-zinc-400"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.1 }}
                >
                  algorithvoice.com
                </motion.a>
              </CardFooter>
            </motion.div>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}
