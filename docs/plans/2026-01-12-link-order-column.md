# Link Order Column Optionality Implementation Plan
# Link Order Column Optionality Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Avoid inserting or validating link order columns unless `hasOrderColumn` is true.

**Architecture:** Gate junction insert SQL and schema rules on link field meta (`hasOrderColumn`). Make junction table rules accept an optional order column so legacy tables without `__order` remain valid, while new tables still create and validate the order column when required.

**Tech Stack:** TypeScript, vitest, Kysely, Teable v2 core/link fields

### Task 1: Add failing test for insert SQL without order column

**Files:**
- Create: `packages/v2/adapter-table-repository-postgres/src/record/query-builder/insert/RecordInsertBuilder.spec.ts`

**Step 1: Write the failing test**

```ts
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { RecordInsertBuilder } from './RecordInsertBuilder';

class RecordingConnection implements DatabaseConnection {
  constructor(private readonly queries: CompiledQuery[]) {}
  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(compiledQuery);
    return { rows: [] };
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
}

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];
  async init() { return undefined; }
  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this.queries);
  }
  async beginTransaction() { return undefined; }
  async commitTransaction() { return undefined; }
  async rollbackTransaction() { return undefined; }
  async releaseConnection() { return undefined; }
  async destroy() { return undefined; }
  async savepoint() { return undefined; }
  async rollbackToSavepoint() { return undefined; }
  async releaseSavepoint() { return undefined; }
}

const createRecordingDb = () => {
  const driver = new RecordingDriver();
  const db = new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, driver };
};

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'c'.repeat(16)}`;
const LOOKUP_FIELD_ID = `fld${'d'.repeat(16)}`;
const LINK_FIELD_ID = `fld${'e'.repeat(16)}`;
const SYMMETRIC_FIELD_ID = `fld${'f'.repeat(16)}`;

const buildTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(FOREIGN_TABLE_ID)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(LOOKUP_FIELD_ID)._unsafeUnwrap();
  const linkFieldId = FieldId.create(LINK_FIELD_ID)._unsafeUnwrap();
  const symmetricFieldId = FieldId.create(SYMMETRIC_FIELD_ID)._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    symmetricFieldId: symmetricFieldId.toString(),
  })._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('LinkInsertTable')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Links')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  return { table, linkFieldId };
};

describe('RecordInsertBuilder', () => {
  it('omits order column when link meta hasOrderColumn is false', () => {
    const { db } = createRecordingDb();
    const { table, linkFieldId } = buildTable();
    const builder = new RecordInsertBuilder(db);

    const fieldValues = new Map<string, unknown>([
      [linkFieldId.toString(), [{ id: 'rec_one' }, { id: 'rec_two' }]],
    ]);

    const result = builder.buildInsertData({
      table,
      fieldValues,
      context: { recordId: 'rec_main', actorId: 'usr_test', now: '2025-01-01T00:00:00.000Z' },
    });

    const statements = result._unsafeUnwrap().additionalStatements.map((stmt) => stmt.compiled.sql);
    expect(statements.some((sql) => sql.includes('__order'))).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/record/query-builder/insert/RecordInsertBuilder.spec.ts`
Expected: FAIL because insert SQL includes `__order` today.

**Step 3: Write minimal implementation**

(Implemented in Task 3.)

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/record/query-builder/insert/RecordInsertBuilder.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/v2/adapter-table-repository-postgres/src/record/query-builder/insert/RecordInsertBuilder.spec.ts
git commit -m "test: cover link insert without order column"
```

### Task 2: Add failing schema rule test for optional junction order column

**Files:**
- Modify: `packages/v2/adapter-table-repository-postgres/src/schema/rules/field/SchemaRules.pglite.spec.ts`

**Step 1: Write the failing test**

Add inside `describe('JunctionTableExistsRule', ...)`:

```ts
it('should allow junction table without order column when config omits it', async () => {
  await createTestTable(SOURCE_TABLE);
  await createTestTable(TARGET_TABLE);

  await sql
    .raw(
      `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
        __id SERIAL PRIMARY KEY,
        self_key TEXT,
        foreign_key TEXT
      )`
    )
    .execute(db);

  const fieldResult = createRealField('jct004', 'Link', 'link_col');
  const field = fieldResult._unsafeUnwrap();

  const linkField = createMockLinkField('jct004', 'Link');
  const config = {
    junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
    selfKeyName: 'self_key',
    foreignKeyName: 'foreign_key',
    sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
    foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
    withIndexes: true,
  } as const;

  const rule = new JunctionTableExistsRule(linkField, config);
  const ctx = createContext(SOURCE_TABLE, field);

  const result = await rule.isValid(ctx);
  expect(result.isOk()).toBe(true);
  expect(result._unsafeUnwrap().valid).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/schema/rules/field/SchemaRules.pglite.spec.ts`
Expected: FAIL because `JunctionTableExistsRule` still requires the order column.

**Step 3: Write minimal implementation**

(Implemented in Task 4.)

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/schema/rules/field/SchemaRules.pglite.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/v2/adapter-table-repository-postgres/src/schema/rules/field/SchemaRules.pglite.spec.ts
git commit -m "test: allow junction table without order column"
```

### Task 3: Gate link insert SQL on hasOrderColumn

**Files:**
- Modify: `packages/v2/adapter-table-repository-postgres/src/record/query-builder/insert/RecordInsertBuilder.ts`
- Modify: `packages/v2/adapter-table-repository-postgres/src/record/visitors/FieldInsertValueVisitor.ts`

**Step 1: Write the failing test**

(Already written in Task 1.)

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/record/query-builder/insert/RecordInsertBuilder.spec.ts`
Expected: FAIL before the fix.

**Step 3: Write minimal implementation**

```ts
const orderColumnName = field.hasOrderColumn() ? yield* field.orderColumnName() : null;

const insertValues: Record<string, unknown> = {
  [selfKeyName]: recordId,
  [foreignKeyName]: linkItem.id,
  ...(orderColumnName ? { [orderColumnName]: order } : {}),
};
```

Apply the same conditional insert logic in `FieldInsertValueVisitor.visitLinkField`.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/record/query-builder/insert/RecordInsertBuilder.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/v2/adapter-table-repository-postgres/src/record/query-builder/insert/RecordInsertBuilder.ts \
  packages/v2/adapter-table-repository-postgres/src/record/visitors/FieldInsertValueVisitor.ts

git commit -m "fix: skip order column on link insert when disabled"
```

### Task 4: Make junction schema rules optional for order column

**Files:**
- Modify: `packages/v2/adapter-table-repository-postgres/src/schema/rules/field/JunctionTableRule.ts`
- Modify: `packages/v2/adapter-table-repository-postgres/src/schema/rules/field/FieldSchemaRulesFactory.ts`

**Step 1: Write the failing test**

(Already written in Task 2.)

**Step 2: Run test to verify it fails**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/schema/rules/field/SchemaRules.pglite.spec.ts`
Expected: FAIL before the fix.

**Step 3: Write minimal implementation**

```ts
export interface JunctionTableConfig {
  // ...
  orderColumnName?: string;
}

const requiredColumns = ['__id', config.selfKeyName, config.foreignKeyName];
if (config.orderColumnName) {
  requiredColumns.push(config.orderColumnName);
}

const builder = schemaBuilder
  .createTable(config.junctionTable.tableName)
  .ifNotExists()
  .addColumn('__id', 'serial', (col) => col.primaryKey())
  .addColumn(config.selfKeyName, 'text')
  .addColumn(config.foreignKeyName, 'text');

if (config.orderColumnName) {
  builder.addColumn(config.orderColumnName, 'double precision');
}
```

In `FieldSchemaRulesFactory`, only compute `orderColumnName` and add `FieldMetaRule.forOrderColumn`/`OrderColumnRule` when `field.hasOrderColumn()` is true.

**Step 4: Run test to verify it passes**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit -- src/schema/rules/field/SchemaRules.pglite.spec.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/v2/adapter-table-repository-postgres/src/schema/rules/field/JunctionTableRule.ts \
  packages/v2/adapter-table-repository-postgres/src/schema/rules/field/FieldSchemaRulesFactory.ts

git commit -m "fix: make junction order column optional"
```

### Task 5: Run package checks

**Files:**
- None

**Step 1: Run unit tests**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres test-unit`
Expected: PASS.

**Step 2: Run lint with fixes**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres lint -- --fix`
Expected: PASS.

**Step 3: Run typecheck**

Run: `pnpm -C packages/v2/adapter-table-repository-postgres typecheck`
Expected: PASS.

**Step 4: Commit formatting updates**

```bash
git add packages/v2/adapter-table-repository-postgres
git commit -m "chore: format link order column changes"
```
