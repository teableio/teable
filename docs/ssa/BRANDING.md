# Branding (SSA) — what can and cannot change

## The rule

This fork is Teable Community Edition under **AGPL-3.0 + a brand-protection
term** (`LICENSE`, "Brand Protection (Under Section 7(e))"):

> The Teable brand assets (name, logo, icons, visual identity) are not covered
> by the AGPLv3 license … You may not modify or replace the Teable brand
> assets; you may not remove the Teable brand assets.

So: **the Teable logo, name and brand assets stay untouched** — anywhere in the
UI, the repo, or the assets. Everything that is _code/design_ (layout, flows,
styling, components) is AGPL and freely modifiable.

## What this fork does instead

The app already has a first-class branding seam — `useBrand()` and
`TeableLogo.tsx` render your brand when configured the right way, without
touching Teable's marks. We wired it to env variables and to the instance
settings:

| Variable         | Effect                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SSA_BRAND_NAME` | Shown wherever the product shows the workspace brand: sidebar "powered by" line, share/embed pages, invite/sign-in helpers, error pages (`useBrand()`), and mirrored into the instance setting `brandName` at boot |
| `SSA_BRAND_LOGO` | When set, the sidebar header renders **your logo image** instead of the default mark (the component's own supported override; Teable's asset stays in the repo)                                                    |

Both are enforced at boot by `SsaBootstrapService` (idempotent, like
`SSA_SINGLE_TENANT`) and piped to the client through the SSR env seam in
`withEnv.ts` (`brandName`/`brandLogo`).

## How to set it

1. **Name** (already active in dev): `SSA_BRAND_NAME=SSA` in the deployment env
   (`apps/nextjs-app/.env.development` locally, your host's secret/env store in
   production). Restart the backend — the sidebar and share surfaces now say
   **SSA**, and `GET /api/admin/setting/public` reports `brandName: "SSA"`.
2. **Logo**: drop your file into `apps/nextjs-app/public/` (e.g. `ssa-logo.svg`)
   — or host it anywhere with a public URL — and set
   `SSA_BRAND_LOGO=/ssa-logo.svg` (relative) or the full URL. Restart. The
   sidebar header shows your mark; keep the file size small (it renders at
   ~24–64 px).

## Why not just delete the Teable files?

- Removing/replacing them breaches the license terms the whole fork rests on
  (and would break asset references across the UI).
- The upstream `LICENSE` and every source file carry the notice; a public fork
  that stripped it would be redistributing Teable in violation.

## If you ever need _zero_ Teable marks (commercial white-label)

That is a licensing question, not a technical one. Options are: keep the
current compliant setup (recommended for internal use), or rebuild the UI
layer on a permissively licensed base (e.g. Baserow MIT core / Grist
Apache-2.0) — the companion services (`ssa/`) are base-independent and would
port with only their API calls adjusted. Talk to counsel before shipping a
white-labeled product.
