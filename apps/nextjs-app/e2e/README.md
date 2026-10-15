# Playwright end-to-end tests (apps/nextjs-app)

Browser tests for the web app. They exercise the pages the way a user reaches
them and assert on the localized UI (`@teable/common-i18n`), so a green run
means: the Next app boots, the Nest backend answers, i18n resolves, the
sign-in flow works and seeded database content renders.

## What is covered

| Spec                          | Covers                                                    |
| ----------------------------- | --------------------------------------------------------- |
| `pages/system/404.spec.ts`    | `/404` and unknown routes render the english 404 page     |
| `pages/system/404-zh.spec.ts` | Client-side localization via the `NEXT_LOCALE` cookie     |
| `pages/index/index.spec.ts`   | `/` → sign-up / sign-in redirects (returning-user cookie) |
| `pages/auth/login.spec.ts`    | Sign-in validation error + a full sign-in into the space  |

The sign-in spec logs in with the `--e2e` database seed
(`packages/db-main-prisma/prisma/seed.ts`): `test@e2e.com` / `12345678`,
space `test space` with base `test base`.

## Running locally

There is no standalone `next dev` script in this app — the Nest backend mounts
the Next.js app on `PORT` (3000). Playwright starts that stack itself unless one
is already running.

```powershell
# 1. Postgres + Redis (Docker Desktop running; network first if it does not exist)
docker network create teablenet   # fails harmlessly when it already exists
docker compose --env-file dockers/.env -f dockers/networks.yml -f dockers/database-postgres.yml -f dockers/cache-redis.yml up -d

# 2. Migrations (first run, or after pulling migrations)
make postgres.mode                # bash; or see Makefile for the two prisma-migrate steps

# 3. Seed the sign-in fixture
pnpm -F @teable/db-main-prisma prisma-db-seed -- --e2e

# 4. Run the suite (boots/reuses http://127.0.0.1:3000)
pnpm -F @teable/app test-e2e
```

Other entry points:

```powershell
pnpm -F @teable/app test-e2e:start   # no hot reload (E2E_WEBSERVER_MODE=START)
pnpm -F @teable/app test-e2e:build   # build web + backend, then run
pnpm -F @teable/app test-e2e:report  # open the last HTML report
```

## Environment variables

| Variable              | Default          | Meaning                                                                                                                                        |
| --------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`        | –                | Target an already-running instance (local stack, preview, deployment); no server is started. The login spec then needs the fixtures there too. |
| `E2E_BROWSER_CHANNEL` | `chrome`         | Playwright `channel` for both projects — the locally installed Google Chrome. Set `chromium` on machines without Chrome.                       |
| `E2E_WEBSERVER_MODE`  | `DEV`            | `DEV` \| `START` \| `BUILD_AND_START` — how the managed local stack starts.                                                                    |
| `E2E_WEB_SERVER_PORT` | `PORT` or `3000` | Port of the managed stack.                                                                                                                     |
| `E2E_USER_EMAIL`      | `test@e2e.com`   | Sign-in account for `pages/auth/login.spec.ts`.                                                                                                |
| `E2E_USER_PASSWORD`   | `12345678`       | Password for the above.                                                                                                                        |

## Reports and artifacts

Everything lands in `apps/nextjs-app/e2e/.out/` (gitignored):

- `reports/html` — interactive HTML report
- `reports/test-results.json` — machine-readable results
- `output/` — screenshots, videos, traces (kept on failure; `trace` is enabled on retry)

## Notes

- Tests drive the locally installed Google Chrome (`channel: 'chrome'`) on a
  desktop viewport and on an emulated Pixel 5. Set `E2E_BROWSER_CHANNEL=chromium`
  where Chrome is not installed.
- `reuseExistingServer` is enabled outside CI: a server you started by hand on
  the port is used as-is.
- The client-side localization specs assume a plain browser locale of `en`
  unless they explicitly set `NEXT_LOCALE`.
