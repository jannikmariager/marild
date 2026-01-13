# Marild Frontend Rebuild – Handover Plan

## Overview
- Fresh Next.js 16 + React 19 project (`marild/`)
- Supabase-connected (reuses existing DB + auth)
- Sections migrated so far:
  - Marketing (landing, pricing, FAQ, legal)
  - Auth (login/signup via Supabase)
  - Dashboard + API routes (still enforcing dark theme, TODO lighten)
  - Admin panel (currently being wired; build in progress)

## Completed Work
1. Bootstrapped clean project with Tailwind 4, shadcn UI, lightweight charts.
2. Copied all marketing route groups and components (`app/(marketing)` + `app/(components)/landing`).
3. Copied auth route group + API routes + Supabase helpers.
4. Migrated dashboard routes (`app/(app)`), API, hooks, lib utilities.
5. Iteratively fixed missing deps/components discovered by Vercel builds (hooks, shared FAQ JSON, markets components, tw-animate-css, Stripe utilities, Supabase client, etc.).
6. Added admin panel pages (`app/admin/...`) from original admin dashboard.
7. Git repo created: `github.com/jannikmariager/marild`, Vercel project: `marild-3otgsjhzm-jannik-mariagers-projects`.

## Outstanding Issues / Next Tasks
1. **Vercel build pipeline:** keep iterating on missing imports as they surface; current blocker (after commit `7fdf5b2`) might be next dependency.
2. **Theme:** dashboard still forced dark locally. After stable deploy, revisit CSS to restore intended light variant (compare with `marild-web-unified` deployment).
3. **Env variables:** ensure all `NEXT_PUBLIC_*`, `STRIPE_*`, `SUPABASE_*`, etc. are added to Vercel project once build succeeds.
4. **Admin functionality:** verify each admin sub-route once deploy succeeds (engines, revenue, signals, etc.).
5. **Documentation:** keep updating this file with each major migration step; add testing instructions once stable.

## How to Continue
1. Run `npm run dev` locally; ensure Supabase env vars exist.
2. For build failures on Vercel:
   - Check dashboard logs OR run `vercel logs <deployment-url>` (only works once deployment reaches Ready/Error).
   - Missing module? Copy from legacy repos: `tradelens_ai/frontend`, `admin-dashboard`.
3. After each fix: `git add …`, commit with summary, push → Vercel redeploys.
4. Track progress here; note remaining TODOs for the next engineer.

_Last updated: 2026-01-13 @ 21:08 UTC by Warp._
