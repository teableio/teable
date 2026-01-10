---
name: teable-v2-devtools
description: Teable v2 developer tools CLI for debugging, inspecting, and generating test data. Combines debug-data and mock-records capabilities into a unified CLI using oclif framework.
---

# Teable V2 DevTools CLI

## When to Use This Skill

Use this skill when you need to:
- View table/field configuration details
- Diagnose formula/lookup/rollup issues
- Understand field dependency relationships
- Analyze computed field update plans (explain commands)
- Generate mock/test data for tables

## Quick Commands

All commands output TOON format for AI consumption.

### Debug Commands

```bash
# View underlying table metadata
pnpm --filter @teable/v2-devtools cli underlying table --table-id tbl...

# List all tables in a base
pnpm --filter @teable/v2-devtools cli underlying tables --base-id bse...

# View field configuration (diagnose formula issues)
pnpm --filter @teable/v2-devtools cli underlying field --field-id fld...

# List all fields in a table
pnpm --filter @teable/v2-devtools cli underlying fields --table-id tbl...

# View field dependencies (diagnose computed field propagation)
pnpm --filter @teable/v2-devtools cli relations --field-id fld... --direction up --level 2

# Explain CreateRecord (analyze computed update plan)
pnpm --filter @teable/v2-devtools cli explain create --table-id tbl...

# Explain UpdateRecord
pnpm --filter @teable/v2-devtools cli explain update --table-id tbl... --record-id rec... --fields '{"Name":"test"}'

# Explain DeleteRecords
pnpm --filter @teable/v2-devtools cli explain delete --table-id tbl... --record-ids rec1,rec2
```

### Mock Data Commands

```bash
# Generate 100 mock records
pnpm --filter @teable/v2-devtools cli mock generate --table-id tbl... --count 100

# Generate with reproducible seed
pnpm --filter @teable/v2-devtools cli mock generate --table-id tbl... --count 50 --seed 12345

# Dry run (preview without inserting)
pnpm --filter @teable/v2-devtools cli mock generate --table-id tbl... --count 10 --dry-run
```

## Command Reference

### underlying Commands

| Command | Description |
|---------|-------------|
| `underlying table --table-id <id>` | Get raw table metadata |
| `underlying tables --base-id <id>` | List all tables in a base |
| `underlying field --field-id <id>` | Get field metadata (includes parsed options/meta JSON) |
| `underlying fields --table-id <id>` | List all fields in a table |

### relations Command

| Option | Description |
|--------|-------------|
| `--field-id <id>` | Required: Starting field ID |
| `--direction up\|down\|both` | `up` = who depends on me, `down` = what I depend on (default: both) |
| `--level <n>` | Max traversal depth (default: unlimited) |
| `--same-table` | Only traverse same-table relations |

### explain Commands

| Command | Description |
|---------|-------------|
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

### mock Commands

| Option | Description |
|--------|-------------|
| `--table-id <id>` | Required: Table ID to generate records for |
| `--count <n>` | Required: Number of records to generate |
| `--seed <n>` | Optional: Seed for reproducible random data |
| `--batch-size <n>` | Optional: Batch size for insertion (default: 100) |
| `--dry-run` | Optional: Only show what would be generated, don't insert |

**Supported Field Types for Mock Data:**

| Field Type | Generated Data |
|------------|----------------|
| SingleLineText | Names/emails/URLs/phones (based on showAs) |
| LongText | Lorem ipsum paragraphs |
| Number | Random floats 0-1000 |
| Rating | Random integers 1 to max rating |
| SingleSelect | Random selection from options |
| MultipleSelect | 1-3 random options |
| Checkbox | Random boolean |
| Date | Recent date within 365 days |
| User | Mock user object `{id, title, email}` |
| Attachment | Mock attachment objects |
| Link | Random IDs from linked table |

## Common Diagnostic Scenarios

### Scenario 1: Formula Field Calculation Error
1. View field config: `underlying field --field-id fld...`
2. Check dependencies: `relations --field-id fld... --direction down`
3. Verify dependent fields are correct

### Scenario 2: Lookup/Rollup Data Inconsistency
1. View lookup field config: `underlying field --field-id fld...`
2. Check `lookupOptions`: linkFieldId, foreignTableId, lookupFieldId
3. Verify the linked link field is correct

### Scenario 3: Field Update Not Propagating
1. Find downstream dependents: `relations --field-id fld... --direction up --level 3`
2. Check if any dependent field has errors: look for `hasError: true`
3. View specific field config: `underlying field --field-id <dependent-field-id>`

### Scenario 4: Analyze Computed Update Performance
1. Explain the command: `explain create --table-id tbl...`
2. Check `computedImpact.updateSteps` for the update plan
3. Look at `complexity.score` and `recommendations`
4. Use `--analyze` flag for actual execution timing

## Global Options

- `-c, --connection <dsn>` - Override DATABASE_URL/PRISMA_DATABASE_URL
- `--help` - Show help message

## Connection

Connection is resolved in the following order:
1. `-c, --connection <dsn>` command line option
2. `PRISMA_DATABASE_URL` environment variable
3. `DATABASE_URL` environment variable
4. Default: `postgresql://teable:teable@127.0.0.1:5432/teable?schema=public`

## Security Notes

- **Mock commands only work with localhost PostgreSQL** (127.0.0.1 or localhost) for safety
- Remote database connections are blocked for mock data generation

## Empty Data Handling

When queries return no data, the CLI provides clear feedback:
- `code: EMPTY_RESULT` indicates no data was found
- The error message includes hints about what to check

**If you see EMPTY_RESULT, report to the user** that the requested data was not found in the database.
