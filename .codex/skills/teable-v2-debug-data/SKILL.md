---
name: teable-v2-debug-data
description: Read-only Teable v2 debug access for base/table/field metadata, field dependency relations, and command explain. Use when asked to inspect underlying DB data (table_meta, field) by baseId/tableId/fieldId, to debug lookup/rollup/link/formula dependencies, to explain upstream/downstream field relationships, or to analyze computed field update plans.
---

# Teable V2 Debug Data

## When to Use This Skill

Use this skill when you need to:
- View table/field configuration details
- Diagnose formula/lookup/rollup issues
- Understand field dependency relationships
- **Analyze computed field update plans (explain commands)**

## Quick Commands

All commands output TOON format for AI consumption.

### View Field Configuration (diagnose formula issues)
```bash
pnpm --filter @teable/v2-debug-data cli underlying field --field-id fld...
```

### View Field Dependencies (diagnose computed field propagation)
```bash
pnpm --filter @teable/v2-debug-data cli relations --field-id fld... --direction up --level 2
```

### Explain CreateRecord (analyze computed update plan)
```bash
pnpm --filter @teable/v2-debug-data cli explain create --table-id tbl...
```

### Explain UpdateRecord
```bash
pnpm --filter @teable/v2-debug-data cli explain update --table-id tbl... --record-id rec... --fields '{"Name":"test"}'
```

## Three-Layer Architecture

### 1. Underlying Layer (`underlying` command)

Direct database access to `table_meta` and `field` tables. Use for diagnosing when domain layer and underlying data are inconsistent.

| Subcommand | Description |
|------------|-------------|
| `underlying table --table-id <id>` | Get raw table metadata |
| `underlying tables --base-id <id>` | List all tables in a base |
| `underlying field --field-id <id>` | Get field metadata (includes parsed options/meta JSON) |
| `underlying fields --table-id <id>` | List all fields in a table |

### 2. Relations Layer (`relations` command)

Query field dependency graphs. Useful for understanding computed field propagation.

| Option | Description |
|--------|-------------|
| `--field-id <id>` | Required: Starting field ID |
| `--direction up\|down\|both` | `up` = who depends on me, `down` = what I depend on (default: both) |
| `--level <n>` | Max traversal depth (default: unlimited) |
| `--same-table` | Only traverse same-table relations |

### 3. Explain Layer (`explain` command)

Analyze command execution plans. Shows computed field update steps, SQL explains, locks, and complexity.

| Subcommand | Description |
|------------|-------------|
| `explain create --table-id <id>` | Explain CreateRecord command |
| `explain update --table-id <id> --record-id <id> --fields <json>` | Explain UpdateRecord command |
| `explain delete --table-id <id> --record-ids <ids>` | Explain DeleteRecords command |

**Explain Options:**
| Option | Description |
|--------|-------------|
| `--table-id <id>` | Required: Table ID |
| `--record-id <id>` | Required for update: Record ID |
| `--record-ids <ids>` | Required for delete: Comma-separated record IDs |
| `--fields <json>` | JSON object of field values (required for update, optional for create) |
| `--analyze` | Run EXPLAIN ANALYZE for actual execution stats (default: false) |

**Explain Output includes:**
- `command`: Command info (type, tableId, recordIds, changedFields, changeType)
- `computedImpact`: Computed field update plan (updateSteps, sameTableBatches, affectedRecordEstimates)
- `computedLocks`: Lock strategy (mode, recordLocks, tableLocks)
- `sqlExplains`: SQL statements with EXPLAIN output
- `complexity`: Complexity score and recommendations
- `timing`: Execution timing breakdown

## Common Diagnostic Scenarios

### Scenario 1: Formula Field Calculation Error
1. View field underlying config: `underlying field --field-id fld...`
2. Check what fields it depends on: `relations --field-id fld... --direction down`
3. Verify dependent fields are correct

### Scenario 2: Lookup/Rollup Data Inconsistency
1. View lookup field config: `underlying field --field-id fld...`
2. Check `lookupOptions`: linkFieldId, foreignTableId, lookupFieldId
3. Verify the linked link field is correct

### Scenario 3: Field Update Not Propagating
1. Find downstream dependents: `relations --field-id fld... --direction up --level 3`
2. Check if any dependent field has errors: look for `hasError: true` in output
3. View specific field config: `underlying field --field-id <dependent-field-id>`

### Scenario 4: Analyze Computed Update Performance
1. Explain the command: `explain create --table-id tbl...`
2. Check `computedImpact.updateSteps` for the update plan
3. Look at `complexity.score` and `recommendations`
4. Use `--analyze` flag for actual execution timing

### Scenario 5: Verify Insert Optimization
1. Run: `explain create --table-id tbl...`
2. For tables with oneMany links (FK not in current table), `updateSteps` should be empty
3. Check that unnecessary link fields are not being computed

## Global Options

- `--connection <dsn>` - Override DATABASE_URL/PRISMA_DATABASE_URL
- `--help` - Show help message

## Connection

Connection is resolved in the following order:
1. `--connection <dsn>` command line option
2. `PRISMA_DATABASE_URL` environment variable
3. `DATABASE_URL` environment variable
4. Default: `postgresql://teable:teable@127.0.0.1:5432/teable?schema=public`

## Empty Data Handling

When queries return no data, the CLI provides clear feedback:
- `code: EMPTY_RESULT` indicates no data was found
- The error message includes hints about what to check

**If you see EMPTY_RESULT, report to the user** that the requested data was not found in the database. This often means:
- The ID is incorrect
- The data doesn't exist in the current database
- The database connection is pointing to a different environment

## Notes

- **Read-only access only** - do not write or mutate data
- Use `--level` to constrain relation traversal when graphs are large
- Output is always TOON format for AI consumption
- For explain commands, use `--analyze` sparingly as it actually executes queries
