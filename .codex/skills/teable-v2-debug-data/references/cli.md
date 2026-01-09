# Debug Data CLI

## Build note

The CLI loads `@teable/v2-debug-data` via its `dist/` output. If it fails to load, build first:

```bash
pnpm -C packages/v2/debug-data build
```

## Commands

```bash
node scripts/v2-debug-data.mjs base --base-id <baseId>
node scripts/v2-debug-data.mjs table --table-id <tableId>
node scripts/v2-debug-data.mjs table --table-id <tableId> --fields
node scripts/v2-debug-data.mjs table-fields --table-id <tableId>
node scripts/v2-debug-data.mjs field --field-id <fieldId>
node scripts/v2-debug-data.mjs field --field-id <fieldId> --relations
node scripts/v2-debug-data.mjs field-relations --field-id <fieldId>
```

## Connection

```bash
DATABASE_URL=postgres://... node scripts/v2-debug-data.mjs table --table-id tbl_...
node scripts/v2-debug-data.mjs table --table-id tbl_... --connection postgres://...
```

## Relation options

```bash
node scripts/v2-debug-data.mjs field-relations --field-id fld_... --direction up
node scripts/v2-debug-data.mjs field-relations --field-id fld_... --direction down --level 2
node scripts/v2-debug-data.mjs field-relations --field-id fld_... --same-table
```

## Output formats

```bash
node scripts/v2-debug-data.mjs field --field-id fld_... --format json
node scripts/v2-debug-data.mjs field --field-id fld_... --format toon
node scripts/v2-debug-data.mjs field --field-id fld_... --format both
```

TOON output is generated with `@toon-format/toon` from the JSON payload.
