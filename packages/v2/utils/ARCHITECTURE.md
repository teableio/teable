# @teable/v2-utils Architecture

## Purpose

- Provide reusable utility helpers that depend on `@teable/v2-core` but stay outside the domain package.
- Keep the package focused on formatting and convenience utilities.

## Folder Map

- `src/printTable.ts`: Render domain tables and raw record payloads into readable ASCII tables.
- `src/index.ts`: Public exports.
- `src/ssrf/registry.ts`: Shared fetch registry, exported separately as `@teable/v2-utils/fetch`
  so browser adapters do not load Node-only SSRF transports. The root and subpath use the same
  registration state; Node hosts still install the guarded fetch implementation.
- `src/ssrf/fetch.ts`: undici dispatcher used by Node/Bun hosts. It refuses a
  blocked peer before the socket opens — IP literals up front (undici skips DNS
  for them) and hostnames through the guarded lookup — then re-checks the
  connected address, so a resolution that changes after lookup still cannot be
  reached. `allowPrivateNetwork` (self-hosted) admits private peers but never
  the cloud-metadata ranges.
- `src/ssrf/agents.ts`: the `http.Agent` counterpart for axios/node-fetch plus
  the shared address policy (`isCloudMetadataAddress`, `createRejectingLookup`).
