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
8. Marketing layout now renders dark theme (Navbar + footer restored, cards restyled).
9. Auth pages now share the dark gradient theme (login/signup match production styling).

## Outstanding Issues / Next Tasks
1. **Dashboard theme:** still forced dark locally. Now that deploy is green, reapply the light palette (compare with `marild-web-unified`).
2. **Runtime QA:** click through Vercel deployment (`marild-3otgsjhzm…`) – dashboard, tradesignals, admin routes.
3. **Admin functionality:** verify engines, revenue, signals, ticker requests, etc. with real data.
4. **Documentation:** keep updating this handover file; add testing instructions once QA is done.

## How to Continue
1. Run `npm run dev` locally; ensure Supabase env vars exist.
2. For build failures on Vercel:
   - Check dashboard logs OR run `vercel logs <deployment-url>` (only works once deployment reaches Ready/Error).
   - Missing module? Copy from legacy repos: `tradelens_ai/frontend`, `admin-dashboard`.
3. After each fix: `git add …`, commit with summary, push → Vercel redeploys.
4. Track progress here; note remaining TODOs for the next engineer.

_Last updated: 2026-01-14 @ 08:35 UTC by Warp (build succeeded on Vercel)._
