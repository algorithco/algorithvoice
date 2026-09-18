/** Onboarding gate: authed but not yet onboarded → wizard. */
export function useOnboardingGate(opts: {
  loggedIn: boolean;
  onboarded: boolean;
}): boolean {
  return opts.loggedIn && !opts.onboarded;
}
