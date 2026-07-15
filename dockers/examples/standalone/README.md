# Example with teable standalone

> Standalone runs the Teable core: tables, collaboration, API and automation.
> For the AI features (chat, App Builder, sandboxes) use the
> [full-featured self-host deployment](https://github.com/teableio/teable-deployment) --
> and if you are already running standalone, your data stays in place when
> [upgrading](https://github.com/teableio/teable-deployment/blob/main/migration/2026-07-basic-to-full-featured.md).

Look into the `.env` file and update the vaiables before executing `docker compose up -d`.

## Teable

- Accessible via `http://127.0.0.1:3000`
- Uses postgres db for storage
- Telemetry is disabled
