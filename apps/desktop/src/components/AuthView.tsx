import type { SessionInfo } from "../lib/session.js";
import LoginCardSection from "./ui/login-signup.js";

// First screen of the app when signed out — full-screen animated login/signup.
// Delegates to the shadcn LoginCardSection (canvas particles + accent lines).
export function AuthView({ onDone }: { onDone: (s: SessionInfo) => void }) {
  return <LoginCardSection onDone={onDone} />;
}
