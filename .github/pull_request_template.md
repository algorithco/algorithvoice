# Pull Request

## What & Why
<!-- Link issue, describe intent. No `fix:` prefix in title — CI enforces Conventional Commits -->

## Branching
- [ ] This PR targets `develop` (feature) or `release/*` (release) — **never push directly to `main`**
- [ ] `main` only receives merges via PR from `develop` / `release/*` / `hotfix/*`

## Checks
- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test` green
- [ ] Shared types changed? Updated `packages/shared-types` first, then backend + frontends atomically
- [ ] No secrets, no real audio fixtures, monochrome only

## Release Notes
<!-- How to test, screenshots if UI, migration steps -->
