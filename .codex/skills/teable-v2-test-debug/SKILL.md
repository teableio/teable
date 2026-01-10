---
name: teable-v2-test-debug
description: Debug Teable v2 tests and failing test cases by prioritizing data reproduction and inspection. Use when asked to debug a test file/spec (unit, integration, or e2e) in packages/v2/*, especially when failures might be caused by table schema, relations, or stored/computed data drift; workflow uses v2-devtools CLI to create a similar table first, then inspects real DB data/relations, and only then reviews code logic.
---

# Teable V2 Test Debug

## Overview

Follow a data-first debugging workflow for Teable v2 tests. The default order is: reproduce data with devtools, inspect real DB data/relations, then analyze code logic.

## Workflow: Data-first test debugging

### 1) Capture failure context

- Identify the failing test name, file path, and the exact assertion that failed.
- Note the expected vs actual values and any IDs shown in logs (base/table/field/record).
- If the failure is e2e or integration, confirm which base or seed data was used.

### 2) Reproduce with devtools first (create similar table)

- Use the v2-devtools CLI to create a minimal table that mirrors the test schema.
- Prefer CLI-based table creation and mock data over hand-written SQL.
- If the schema is complex, build only the fields involved in the failing assertion.

Common commands:

```bash
# Get field schema documentation before creating tables
pnpm --filter @teable/v2-devtools cli tables describe-schema

# Create a table with minimal fields
pnpm --filter @teable/v2-devtools cli tables create --base-id bse... --name "Test Table" --fields '[{"type":"singleLineText","name":"Name","isPrimary":true}]'

# Generate mock records if data shape matters
pnpm --filter @teable/v2-devtools cli mock generate --table-id tbl... --count 10 --seed 12345
```

If the v2-devtools skill exists, open `/Users/nichenqin/projects/teable/.codex/skills/teable-v2-devtools/SKILL.md` for the full command reference and validation rules.

### 3) Inspect real DB data and relations

- Compare application layer vs underlying data first; use stored/computed modes.
- Inspect dependencies and relations to confirm lookup/rollup/formula inputs.
- Validate schema constraints if missing indexes or FK columns are suspected.

Common commands:

```bash
# App-layer data (stored/computed) vs underlying
pnpm --filter @teable/v2-devtools cli records list --table-id tbl... --mode stored --limit 10
pnpm --filter @teable/v2-devtools cli records list --table-id tbl... --mode computed --limit 10
pnpm --filter @teable/v2-devtools cli underlying records --table-id tbl... --limit 10

# Inspect a field and its dependencies
pnpm --filter @teable/v2-devtools cli underlying field --field-id fld...
pnpm --filter @teable/v2-devtools cli relations --field-id fld... --direction up --level 2

# Check schema integrity if queries are slow or failing
pnpm --filter @teable/v2-devtools cli schema table --table-id tbl...
```

### 4) Only then review code logic

- Map the observed data mismatch back to the handler, visitor, or mapper.
- Verify spec/visitor logic before touching application wiring.
- If the bug is only reproducible with real DB data, prefer adjusting fixtures or seeding rather than altering logic.

### 5) Decide next action

- If app-layer vs underlying differs, focus on computed/stored pipeline and mappers.
- If dependencies are wrong, fix field definitions or relation setup first.
- If reproduction fails on minimal data, debug core logic with a tight fixture.
