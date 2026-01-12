name: teable-v2-devtools
description: Teable v2 developer tools CLI for debugging, inspecting, and generating test data. Combines debug-data and mock-records capabilities into a unified CLI using Effect CLI framework.

---

# Teable V2 DevTools CLI

## When to Use This Skill

Use this skill when you need to:

- View table/field configuration details
- Diagnose formula/lookup/rollup issues
- Understand field dependency relationships
- Analyze computed field update plans (explain commands)
- Generate mock/test data for tables
- **Query records data** (via application layer or direct database access)
- **Create, update, delete records** (via application layer commands)
- **Check database schema** (indexes, constraints, columns) for missing or broken indexes
- **Create tables** (via CLI, without records)

> **Important**: When you need to inspect database data, **prefer DevTools CLI over psql**. DevTools outputs structured TOON format, which is easier for AI analysis and supports comparing application-layer and database-layer results.

## Development Notes (CRITICAL)

### Rebuild After Modifying Dependencies

DevTools CLI depends on multiple v2 packages, and it uses **compiled dist outputs** rather than TypeScript sources. This is because it relies on parameter decorators (`@inject()`), which tsx/esbuild cannot run directly.

**If you modify any of the following packages, you must rebuild them before running the CLI:**

```bash
# If you modify adapter-table-repository-postgres
pnpm --filter @teable/v2-adapter-table-repository-postgres build

# If you modify command-explain
pnpm --filter @teable/v2-command-explain build

# If you modify debug-data
pnpm --filter @teable/v2-debug-data build

# If you modify core
pnpm --filter @teable/v2-core build
```

**Recommended: use watch mode for auto-rebuilds**

```bash
# Start watch mode in a separate terminal
pnpm --filter @teable/v2-adapter-table-repository-postgres dev
```

**Common pitfalls:**

- CLI output doesn’t change after code edits → forgot to rebuild
- console.log/console.error never prints → forgot to rebuild
- newly added types/functions missing → forgot to rebuild

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

### Schema Check Commands

Use these commands to verify database schema integrity, especially when you suspect missing indexes might be causing slow queries.

```bash
# Check all fields in a table for missing indexes, constraints, columns
pnpm --filter @teable/v2-devtools cli schema table --table-id tbl...

# Check a specific field for missing schema elements
pnpm --filter @teable/v2-devtools cli schema field --table-id tbl... --field-id fld...
```

### Records Query Commands

```bash
# List records via application layer (stored mode - pre-computed values)
pnpm --filter @teable/v2-devtools cli records list --table-id tbl... --limit 100 --offset 0

# List records via application layer (computed mode - calculated on-the-fly)
pnpm --filter @teable/v2-devtools cli records list --table-id tbl... --mode computed

# Get single record via application layer
pnpm --filter @teable/v2-devtools cli records get --table-id tbl... --record-id rec...

# List records directly from underlying PostgreSQL table (raw data)
pnpm --filter @teable/v2-devtools cli underlying records --table-id tbl... --limit 100

# Get single record directly from underlying PostgreSQL table
pnpm --filter @teable/v2-devtools cli underlying record --table-id tbl... --record-id rec...
```

### Records Mutation Commands

```bash
# Create a new record
pnpm --filter @teable/v2-devtools cli records create --table-id tbl... --fields '{"Name":"New Record"}'

# Create a record with typecast (auto-convert values)
pnpm --filter @teable/v2-devtools cli records create --table-id tbl... --fields '{"Name":"Test"}' --typecast

# Update an existing record
pnpm --filter @teable/v2-devtools cli records update --table-id tbl... --record-id rec... --fields '{"Name":"Updated Name"}'

# Update with typecast
pnpm --filter @teable/v2-devtools cli records update --table-id tbl... --record-id rec... --fields '{"Status":"Done"}' --typecast

# Delete records (comma-separated IDs)
pnpm --filter @teable/v2-devtools cli records delete --table-id tbl... --record-ids rec1,rec2,rec3
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

### Table Management Commands

```bash
# Create a simple table with default fields (just a primary Name field)
pnpm --filter @teable/v2-devtools cli tables create --base-id bse... --name "My Table"

# Create a table with custom fields
pnpm --filter @teable/v2-devtools cli tables create --base-id bse... --name "Tasks" --fields '[{"type":"singleLineText","name":"Title","isPrimary":true},{"type":"singleSelect","name":"Status","options":{"choices":[{"name":"Todo"},{"name":"Done"}]}},{"type":"date","name":"Due Date"}]'
```

## Command Reference

### underlying Commands

| Command                                              | Description                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `underlying table --table-id <id>`                   | Get raw table metadata                                               |
| `underlying tables --base-id <id>`                   | List all tables in a base                                            |
| `underlying field --field-id <id>`                   | Get field metadata (includes parsed options/meta JSON)               |
| `underlying fields --table-id <id>`                  | List all fields in a table                                           |
| `underlying records --table-id <id>`                 | List records directly from PostgreSQL (raw data with system columns) |
| `underlying record --table-id <id> --record-id <id>` | Get single record directly from PostgreSQL                           |

### records Commands (Application Layer)

| Command                                            | Description                               |
| -------------------------------------------------- | ----------------------------------------- |
| `records list --table-id <id>`                     | List records via query repository         |
| `records get --table-id <id> --record-id <id>`     | Get single record via query repository    |
| `records create --table-id <id> --fields <json>`   | Create a new record via command bus       |
| `records update --table-id <id> --record-id <id> --fields <json>` | Update an existing record via command bus |
| `records delete --table-id <id> --record-ids <ids>` | Delete records via command bus           |

**Records Query Options:**
| Option | Description |
|--------|-------------|
| `--table-id <id>` | Required: Table ID |
| `--record-id <id>` | Required for get: Record ID |
| `--limit <n>` | Max records to return (default: 100) |
| `--offset <n>` | Records to skip (default: 0) |
| `--mode stored\|computed` | Query mode (default: stored) |

**Mode Explanation:**

- `stored`: Read pre-computed values from the database (fast, uses cached values)
- `computed`: Calculate field values on-the-fly (slower, always fresh)

**Records Mutation Options:**
| Option | Description |
|--------|-------------|
| `--table-id <id>` | Required: Table ID |
| `--record-id <id>` | Required for update: Record ID |
| `--record-ids <ids>` | Required for delete: Comma-separated record IDs |
| `--fields <json>` | JSON object of field values (required for update, optional for create) |
| `--typecast` | Enable typecast mode to auto-convert values (default: false) |

**Typecast Mode:**

When `--typecast` is enabled, the system will attempt to convert input values to the correct field types:
- String "123" → Number 123
- Link field titles → Link field record IDs
- Date strings → Date objects

### relations Command

| Option                       | Description                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| `--field-id <id>`            | Required: Starting field ID                                         |
| `--direction up\|down\|both` | `up` = who depends on me, `down` = what I depend on (default: both) |
| `--level <n>`                | Max traversal depth (default: unlimited)                            |
| `--same-table`               | Only traverse same-table relations                                  |

### schema Commands

Use these commands when analyzing slow queries or suspecting missing indexes.

| Command                                        | Description                                   |
| ---------------------------------------------- | --------------------------------------------- |
| `schema table --table-id <id>`                 | Check all fields in a table for schema issues |
| `schema field --table-id <id> --field-id <id>` | Check a specific field for schema issues      |

**Schema Check Output:**

The output includes a summary with:

- `total`: Total number of schema rules checked
- `success`: Rules that passed validation
- `errors`: Critical issues (missing indexes, columns, constraints)
- `warnings`: Non-critical issues

Each result item includes:

- `fieldId`, `fieldName`: The field being checked
- `ruleId`: Type of rule (e.g., `index`, `unique_index`, `fk_column`, `fk`)
- `ruleDescription`: Human-readable description
- `status`: `success`, `error`, or `warn`
- `message`: Details about the issue
- `details.missing`: List of missing schema objects (index names, column names, etc.)

**Rule Types Checked:**
| Rule Type | Description |
|-----------|-------------|
| `column` | Physical column exists |
| `fk_column` | Foreign key column exists |
| `index` | Non-unique index exists (for FK lookups) |
| `unique_index` | Unique index exists (for one-to-one relations) |
| `fk` | Foreign key constraint exists |
| `junction_table` | Junction table exists (many-to-many) |
| `junction_index` | Junction table indexes exist |
| `junction_fk` | Junction table foreign keys exist |
| `generated_column` | Generated column (auto-number, created_time, etc.) |

### explain Commands

| Command                                                           | Description                   |
| ----------------------------------------------------------------- | ----------------------------- |
| `explain create --table-id <id>`                                  | Explain CreateRecord command  |
| `explain update --table-id <id> --record-id <id> --fields <json>` | Explain UpdateRecord command  |
| `explain delete --table-id <id> --record-ids <ids>`               | Explain DeleteRecords command |

**Explain Options:**
| Option | Description |
|--------|-------------|
| `--table-id <id>` | Required: Table ID |
| `--record-id <id>` | Required for update: Record ID |
| `--record-ids <ids>` | Required for delete: Comma-separated record IDs |
| `--fields <json>` | JSON object of field values (required for update, optional for create) |
| `--analyze` | Run EXPLAIN ANALYZE for actual execution stats (default: false) |

### mock Commands

| Option             | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `--table-id <id>`  | Required: Table ID to generate records for                |
| `--count <n>`      | Required: Number of records to generate                   |
| `--seed <n>`       | Optional: Seed for reproducible random data               |
| `--batch-size <n>` | Optional: Batch size for insertion (default: 100)         |
| `--dry-run`        | Optional: Only show what would be generated, don't insert |

**Supported Field Types for Mock Data:**

| Field Type     | Generated Data                             |
| -------------- | ------------------------------------------ |
| SingleLineText | Names/emails/URLs/phones (based on showAs) |
| LongText       | Lorem ipsum paragraphs                     |
| Number         | Random floats 0-1000                       |
| Rating         | Random integers 1 to max rating            |
| SingleSelect   | Random selection from options              |
| MultipleSelect | 1-3 random options                         |
| Checkbox       | Random boolean                             |
| Date           | Recent date within 365 days                |
| User           | Mock user object `{id, title, email}`      |
| Attachment     | Mock attachment objects                    |
| Link           | Random IDs from linked table               |

### tables Commands

| Command                                      | Description                                            |
| -------------------------------------------- | ------------------------------------------------------ |
| `tables create --base-id <id> --name <name>` | Create a new table (without records)                   |
| `tables describe-schema`                     | **Output field schema documentation for AI reference** |

> **Important**: Before creating tables, **you must run `tables describe-schema`** to get the full field schema documentation and avoid validation errors.

**tables create Options:**
| Option | Description |
|--------|-------------|
| `--base-id <id>` | Required: Base ID where table will be created |
| `--name <name>` | Required: Table name |
| `--fields <json>` | Optional: JSON array of field definitions |

**Critical validation rules (must follow):**

1. **SingleSelect/MultipleSelect choices must include a `color` property** - e.g. `{"name": "Todo", "color": "blueLight1"}`
2. **Link fields must include `foreignTableId` and `lookupFieldId`** - query the target table to get these IDs first
3. **Each table can only have one field with `isPrimary: true`**

**Field Definition Format:**

```json
[
  { "type": "singleLineText", "name": "Title", "isPrimary": true },
  { "type": "number", "name": "Amount" },
  { "type": "date", "name": "Due Date" },
  {
    "type": "singleSelect",
    "name": "Status",
    "options": {
      "choices": [
        { "name": "Todo", "color": "grayLight1" },
        { "name": "Done", "color": "greenLight1" }
      ]
    }
  },
  { "type": "checkbox", "name": "Completed" }
]
```

**Link Field Example:**

```json
{
  "type": "link",
  "name": "Company",
  "options": {
    "relationship": "manyOne",
    "foreignTableId": "tblXXXXXXXX",
    "lookupFieldId": "fldYYYYYYYY"
  }
}
```

- `relationship`: `oneOne` (1:1), `oneMany` (1:N), `manyOne` (N:1), `manyMany` (N:N)
- `lookupFieldId`: Primary field ID of the foreign table (usually the first field)

**Supported Field Types:**

- `singleLineText`, `longText`, `number`, `date`, `checkbox`
- `singleSelect`, `multipleSelect` (requires `options.choices` with color)
- `rating`, `attachment`, `user`
- `link` (requires `options.foreignTableId`, `options.lookupFieldId`, `options.relationship`)
- `formula`, `rollup`, `lookup` (computed fields)
- `autoNumber`, `createdTime`, `lastModifiedTime`, `createdBy`, `lastModifiedBy`

**Valid Colors for Select Choices:**
`blueLight2`, `blueLight1`, `blueBright`, `blue`, `blueDark1`,
`cyanLight2`, `cyanLight1`, `cyanBright`, `cyan`, `cyanDark1`,
`grayLight2`, `grayLight1`, `grayBright`, `gray`, `grayDark1`,
`greenLight2`, `greenLight1`, `greenBright`, `green`, `greenDark1`,
`orangeLight2`, `orangeLight1`, `orangeBright`, `orange`, `orangeDark1`,
`pinkLight2`, `pinkLight1`, `pinkBright`, `pink`, `pinkDark1`,
`purpleLight2`, `purpleLight1`, `purpleBright`, `purple`, `purpleDark1`,
`redLight2`, `redLight1`, `redBright`, `red`, `redDark1`,
`tealLight2`, `tealLight1`, `tealBright`, `teal`, `tealDark1`,
`yellowLight2`, `yellowLight1`, `yellowBright`, `yellow`, `yellowDark1`

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
3. Cross-check dependencies using `relations` on key fields (formula/link/lookup/rollup) to confirm `reference`-derived edges are present; do not rely solely on explain output.
4. Look at `complexity.score` and `recommendations`
5. Use `--analyze` flag for actual execution timing

### Scenario 5: Data Inconsistency Between Application and Database

When data shown in the UI doesn't match what you expect, compare application layer and database layer:

1. **Query via application layer (stored mode)**:

   ```bash
   pnpm --filter @teable/v2-devtools cli records list --table-id tbl... --limit 10 --mode stored
   ```

2. **Query via application layer (computed mode)**:

   ```bash
   pnpm --filter @teable/v2-devtools cli records list --table-id tbl... --limit 10 --mode computed
   ```

3. **Query directly from database**:
   ```bash
   pnpm --filter @teable/v2-devtools cli underlying records --table-id tbl... --limit 10
   ```

**Compare the results:**

- If `stored` ≠ `computed`: The stored cache is stale, computed values haven't been persisted
- If `stored` ≠ `underlying`: Application layer transformation issue
- If `computed` ≠ `underlying`: Field calculation logic issue

### Scenario 6: Creating and Managing Test Records

When you need to quickly create, update, or delete test records for debugging:

1. **Create a test record**:

   ```bash
   pnpm --filter @teable/v2-devtools cli records create --table-id tbl... --fields '{"Name":"Test Record","Status":"Todo"}'
   ```

2. **Update the record** (use the recordId from step 1):

   ```bash
   pnpm --filter @teable/v2-devtools cli records update --table-id tbl... --record-id rec... --fields '{"Status":"Done"}'
   ```

3. **Delete test records when done**:
   ```bash
   pnpm --filter @teable/v2-devtools cli records delete --table-id tbl... --record-ids rec1,rec2
   ```

**Tip:** Use `--typecast` when you want to input human-readable values (like link field titles instead of record IDs).

### Scenario 7: Slow Query Performance (Missing Indexes)

When queries are slow, especially for Link fields or tables with many records:

1. **Check schema for the entire table**:

   ```bash
   pnpm --filter @teable/v2-devtools cli schema table --table-id tbl...
   ```

2. **Look for errors in the output**, especially:

   - `index:*` rules with `status: error` - missing index on foreign key column
   - `unique_index:*` rules - missing unique index for one-to-one relations
   - `junction_index:*` rules - missing indexes on junction tables (many-to-many)

3. **Check a specific Link field**:

   ```bash
   pnpm --filter @teable/v2-devtools cli schema field --table-id tbl... --field-id fldLinkField
   ```

4. **Common missing index patterns**:
   - Link field (one-to-many): Should have `index` on `fld_{fieldId}__id` column
   - Link field (one-to-one): Should have `unique_index` on `fld_{fieldId}__id` column
   - Link field (many-to-many): Junction table should have indexes on both FK columns

## Global Options

- `-c, --connection <dsn>` - Override DATABASE_URL/PRISMA_DATABASE_URL
- `--help` - Show help message

## Connection

Connection is resolved in the following order:

1. `-c, --connection <dsn>` command line option
2. `PRISMA_DATABASE_URL` environment variable
3. `DATABASE_URL` environment variable
4. Default: `postgresql://teable:teable@127.0.0.1:5432/teable?schema=public`

## PGlite Mode (Temporary Database)

DevTools supports **pglite** for file-persisted temporary databases. This is useful for testing table creation and other operations without a real PostgreSQL server.

### When to Use PGlite

Use pglite (`pglite://` connection string) when:

- **Creating temporary tables for testing** - no existing database needed
- **Testing table schema designs** before deploying to production
- **Isolated experiments** that shouldn't affect real data
- **No PostgreSQL server available** (local development without Docker)

### When NOT to Use PGlite

Do NOT use pglite when:

- **User provided a real database URL** (postgresql://)
- **Verifying existing IDs** (tableId, fieldId, recordId, baseId)
- **Querying production/development data**
- **Debugging issues with real tables**

### PGlite Connection String Format

```
pglite://<data-directory-path>
```

Examples:

- `pglite://.pglite-data/session-001` (relative path)
- `pglite:///absolute/path/to/data` (absolute path)

### Using PGlite

**Step 1: Create a pglite session**

First, create a table with a unique pglite connection string. The CLI will automatically:

- Create the data directory
- Initialize the database schema
- Create a space and base
- Return the generated baseId

```bash
# Create a new pglite session with a table
pnpm --filter @teable/v2-devtools cli tables create \
  --connection "pglite://.pglite-data/session-$(date +%s)" \
  --base-id "bseXXXXXXXXXXXXX" \
  --name "Test Table"
```

> **Note**: For the first command, you need to provide any baseId (it will be created). Check the output for the actual baseId to use in subsequent commands.

**Step 2: Reuse the same session**

In the same conversation/session, **remember and reuse** the same connection string and baseId:

```bash
# Query tables in the same pglite database
pnpm --filter @teable/v2-devtools cli underlying tables \
  --connection "pglite://.pglite-data/session-1234567890" \
  --base-id "bseXXXXXXXXXXXXX"

# Create more tables in the same base
pnpm --filter @teable/v2-devtools cli tables create \
  --connection "pglite://.pglite-data/session-1234567890" \
  --base-id "bseXXXXXXXXXXXXX" \
  --name "Another Table"
```

### Important Notes for AI

1. **Remember the session**: Store the pglite connection string and baseId for the entire conversation
2. **Data persists in files**: Data is saved to `.pglite-data/` directory (git-ignored)
3. **Isolated sessions**: Each unique path creates a separate database
4. **First-time init**: The first command to a new pglite path will initialize schema + space + base

### Data Storage

PGlite data is stored in:

```
packages/v2/devtools/.pglite-data/
├── session-1234567890/
│   ├── ... (pglite database files)
├── session-0987654321/
│   └── ...
```

This directory is git-ignored and can be safely deleted to clean up test data.

## Empty Data Handling

When queries return no data, the CLI provides clear feedback:

- `code: EMPTY_RESULT` indicates no data was found
- The error message includes hints about what to check

**If you see EMPTY_RESULT, report to the user** that the requested data was not found in the database.
