---
name: teable-v2-mock-records
description: Generate mock/fake data for Teable v2 tables. Use when asked to create test data, seed data, or generate sample records for a table. Only works with localhost PostgreSQL connections for safety.
---

# Teable V2 Mock Records Generator

## When to Use This Skill

Use this skill when you need to:
- Generate test/mock data for a table
- Seed a table with sample records
- Create fake data for demos or development
- Fill a table with realistic sample data

**SECURITY**: This CLI only works with localhost PostgreSQL connections (127.0.0.1 or localhost).

## Quick Commands

All commands output TOON format for AI consumption.

### Generate Mock Records
```bash
pnpm --filter @teable/v2-mock-records cli generate --table-id tbl... --count 100
```

### Generate with Reproducible Seed (for testing)
```bash
pnpm --filter @teable/v2-mock-records cli generate --table-id tbl... --count 50 --seed 12345
```

### Dry Run (preview without inserting)
```bash
pnpm --filter @teable/v2-mock-records cli generate --table-id tbl... --count 10 --dry-run
```

## Command Options

| Option | Description |
|--------|-------------|
| `--table-id <id>` | Required: Table ID to generate records for |
| `--count <n>` | Required: Number of records to generate |
| `--seed <n>` | Optional: Seed for reproducible random data (useful for tests) |
| `--batch-size <n>` | Optional: Batch size for insertion (default: 100) |
| `--dry-run` | Optional: Preview generated data without inserting |

## How Mock Data is Generated

The generator creates realistic data based on field types:

| Field Type | Generated Data |
|------------|---------------|
| SingleLineText | Person name (or email/url/phone based on `showAs`) |
| LongText | Lorem ipsum paragraph |
| Number | Random float 0-1000 |
| Rating | Random int 1 to max rating |
| SingleSelect | Random option from available choices |
| MultipleSelect | 1-3 random options |
| Checkbox | Random boolean |
| Date | Recent date (within 365 days) |
| User | Mock user object `{id, title, email}` |
| Attachment | Mock attachment objects |
| Link | Random IDs from linked table (if available) |

**Computed fields** (Formula, Rollup, Lookup) are skipped - they calculate automatically.

## Link Field Handling

For tables with Link fields, the generator will:
1. Try to use existing record IDs from the foreign table
2. If no records exist in foreign table, Link field will be `null`

**Tip**: When generating data for related tables, generate the "parent" table first, then the table with Link fields.

## Connection

Connection is resolved in the following order:
1. `--connection <dsn>` command line option
2. `PRISMA_DATABASE_URL` environment variable
3. `DATABASE_URL` environment variable
4. Default: `postgresql://teable:teable@127.0.0.1:5432/teable?schema=public`

## Examples

### Generate 100 records for a table
```bash
pnpm --filter @teable/v2-mock-records cli generate --table-id tbl_xxx --count 100
```

### Generate reproducible test data
```bash
# Same seed = same data every time
pnpm --filter @teable/v2-mock-records cli generate --table-id tbl_xxx --count 50 --seed 42
```

### Preview what would be generated
```bash
pnpm --filter @teable/v2-mock-records cli generate --table-id tbl_xxx --count 5 --dry-run
```

## Output Format

Success output includes:
- `tableId`: The target table ID
- `tableName`: The table name
- `totalGenerated`: Number of records generated
- `totalInserted`: Number of records inserted (0 if dry-run)
- `dryRun`: Whether this was a dry run
- `seed`: The seed used (null if random)
- `sampleRecords`: First 5 records as sample

## Notes

- **Localhost only** - Remote database connections are blocked for safety
- Uses `@faker-js/faker` for realistic data generation
- Seed support enables reproducible test data
- Computed fields are automatically calculated by the database
