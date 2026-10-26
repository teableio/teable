# v2/app-bundle Architecture Notes

## Responsibilities

- Define the deployable table-app bundle format: manifest, DotTea structure,
  optional seed rows, and optional forward SQL migrations.
- Build deterministic archives and verify them before installation.
- Install a bundle into an `IHeadlessRuntime`: base creation, structure import,
  first-install seeding, upgrade migrations, and an install record.
- Stay outside `@teable/v2-core`; app packaging and upgrade policy are host
  concerns.

## Boundaries

- `@teable/v2-core` remains the Table bounded context. No bundle, app, version,
  or migration concept enters core commands or ports.
- Structure import uses the existing `ImportDotTeaStructureCommand`; this package
  does not parse or build tables itself.
- The host owns identity, distribution, signing, and authorization. `actorId`
  is passed through to commands, nothing more.
- Migrations are authored SQL, not a schema-diff engine, and only move forward.
- The host composition root registers `v2CoreTokens.dotTeaParser`. Install reads
  that dependency from the container and fails with
  `install.dot_tea_parser_missing`; it never registers services itself.

## Modules

- `src/schema.ts` - Manifest, checksum, structure, and seed zod schemas.
- `src/checksums.ts` - Section digests and the stable bundle checksum.
- `src/bundle.ts` - `buildAppBundle` / `readAppBundle`, archive entry policy,
  checksum verification, seed-to-structure validation.
- `src/install.ts` - Install/upgrade flow, install record, seeding.
- `src/sql.ts` - Statement splitter for multi-statement migration files.
- `src/index.ts` - Public API.
- `src/index.spec.ts` - Roundtrip, install, idempotency, upgrade, downgrade,
  parser-registration, and tampering coverage on PGlite.

## Install flow

```
readAppBundle(bytes)
  -> unzip + entry policy + manifest/schema validation + section checksums
  -> find install row (app_id)

existing row?
  schemaVersion < installed        -> reject (install.schema_downgrade)
  schemaVersion == installed
    same version, other checksum   -> reject (install.version_conflict)
    otherwise                      -> optional row refresh, return existing
  schemaVersion > installed
    require migrations/<v>.sql for each step
    apply statements in one transaction, then update the row

no row?
  require v2CoreTokens.dotTeaParser   -> reject (install.dot_tea_parser_missing)
  CreateBaseCommand
  ImportDotTeaStructureCommand.createFromBuffer(bytes)  // bundle is also a .tea zip
  remap seed ids through tableIdMap/fieldIdMap
  CreateRecordsCommand per seed table
  insert install row
```

Structure import generates new table/field/view ids. Seed files are keyed by the
source ids from `structure.json`; installation translates them through the
import result maps before calling `CreateRecordsCommand`.

## Install record

`public.app_bundle_install` lives in the data database (resolved through
`v2DataDbTokens.db`). `checksum` is not in the original MVP column list but is
required to reject "same version, different content" without re-reading old
bundles.

## Consistency model

- Migrations and the install-row update share one database transaction.
- Base creation, structure import, and seeding use the command bus and its own
  unit-of-work transactions; they are not part of the Kysely transaction.
- Seed rows are written only on first install; upgrades do not re-seed.
- A failed first install can leave an orphan base. The install row is written
  last, so the next attempt creates another base rather than pretending the
  previous one is complete.

## Limits

- Node/Bun only (`node:crypto`, `fflate`).
- No bundle signing, encryption, compression policy, or distribution.
- No down migrations or automatic schema diffing.
- Seed values are addressed by field id only; no name-based seed files.
- Historic migrations are skipped on first install; `structure.json` is the
  current schema.
- `minRuntimeVersion` is metadata; this package does not enforce runtime
  versions yet.
