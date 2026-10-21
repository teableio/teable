/**
 * Integration tests for TableSchemaUpdateVisitor using PGlite.
 *
 * These tests validate that the generated SQL statements actually work
 * against a real PostgreSQL-compatible database using PGlite.
 */
import { PGlite } from '@electric-sql/pglite';
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  LinkFieldConfig,
  Table,
  TableId,
  TableName,
  TableRemoveFieldSpec,
  UpdateLinkRelationshipSpec,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { CompiledQuery } from 'kysely';
import { Kysely, sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TableSchemaUpdateVisitor } from '../TableSchemaUpdateVisitor';
import { PGliteDialect } from './helpers/createPGliteDb';
import { createTextField } from './helpers/fieldFactories';

/**
 * The schema executors run a statement through its custom `execute` hook when it
 * has one, otherwise through its compiled SQL. These tests mirror that contract
 * so a statement that reads the metadata plane and writes the data plane is
 * exercised the same way production does.
 */
type SchemaStatementHandles = {
  readonly dataDb: Kysely<V1TeableDatabase>;
  readonly metaDb: Kysely<V1TeableDatabase>;
};

type ExecutableSchemaStatement = {
  readonly scope: 'data' | 'meta';
  readonly execute?: (handles: {
    readonly scopedDb: Kysely<V1TeableDatabase>;
    readonly dataDb: Kysely<V1TeableDatabase>;
    readonly metaDb: Kysely<V1TeableDatabase>;
  }) => Promise<void>;
  readonly compile: (db: Kysely<V1TeableDatabase>) => CompiledQuery;
};

/** Mirrors the executor: a statement runs on the handle its scope selects. */
const executeSchemaStatement = async (
  statement: ExecutableSchemaStatement,
  handles: SchemaStatementHandles
): Promise<void> => {
  const scopedDb = statement.scope === 'meta' ? handles.metaDb : handles.dataDb;
  if (statement.execute) {
    await statement.execute({ scopedDb, dataDb: handles.dataDb, metaDb: handles.metaDb });
    return;
  }

  await scopedDb.executeQuery(statement.compile(scopedDb));
};

/**
 * The managed-search statements read their coverage contract from the query-ops
 * management tables, which live in the metadata database (`public` in tests).
 */
const ensureSearchMetadataTables = async (db: Kysely<V1TeableDatabase>): Promise<void> => {
  await sql`
    CREATE TABLE IF NOT EXISTS public.table_meta (
      "id" text PRIMARY KEY,
      "search_index" jsonb,
      "version" integer NOT NULL DEFAULT 0
    )
  `.execute(db);
  await sql`
    CREATE TABLE IF NOT EXISTS public.table_query_search_vector_config (
      "table_id" text NOT NULL,
      "candidate_key" text NOT NULL,
      "status" text NOT NULL,
      "field_ids" jsonb,
      "last_inspection" jsonb,
      "last_modified_time" timestamp with time zone,
      PRIMARY KEY ("table_id", "candidate_key")
    )
  `.execute(db);
};

describe('TableSchemaUpdateVisitor (PGlite)', () => {
  describe('NOT NULL constraint', () => {
    it.todo(
      'should successfully add NOT NULL constraint to column with non-null values'
      // Setup: Create table, insert non-null values
      // Execute: Run SET NOT NULL statement
      // Verify: Column has NOT NULL constraint (check information_schema)
    );

    it.todo(
      'should successfully remove NOT NULL constraint'
      // Setup: Create table with NOT NULL column
      // Execute: Run DROP NOT NULL statement
      // Verify: Column allows NULL values
    );

    it.todo(
      'should fail to add NOT NULL constraint if NULL values exist'
      // Setup: Create table, insert some NULL values
      // Execute: Attempt SET NOT NULL
      // Verify: PostgreSQL error thrown
    );

    it.todo(
      'should allow inserting NULL after dropping NOT NULL constraint'
      // Setup: Create table with NOT NULL, drop constraint
      // Execute: INSERT NULL value
      // Verify: Insert succeeds
    );
  });

  describe('UNIQUE constraint', () => {
    it.todo(
      'should successfully add UNIQUE constraint to column with unique values'
      // Setup: Create table, insert unique values
      // Execute: Run ADD CONSTRAINT UNIQUE statement
      // Verify: Constraint exists (check pg_constraint or information_schema)
    );

    it.todo(
      'should successfully remove UNIQUE constraint'
      // Setup: Create table with UNIQUE constraint
      // Execute: Run DROP CONSTRAINT statement
      // Verify: Duplicate values can be inserted
    );

    it.todo(
      'should fail to add UNIQUE constraint if duplicates exist'
      // Setup: Create table, insert duplicate values
      // Execute: Attempt ADD CONSTRAINT UNIQUE
      // Verify: PostgreSQL error thrown
    );

    it.todo(
      'should allow duplicate values after dropping UNIQUE constraint'
      // Setup: Create table with UNIQUE, drop constraint
      // Execute: INSERT duplicate value
      // Verify: Insert succeeds
    );

    it.todo(
      'should handle DROP CONSTRAINT IF EXISTS gracefully'
      // Setup: Create table without constraint
      // Execute: Run DROP CONSTRAINT IF EXISTS
      // Verify: No error thrown
    );
  });

  describe('Rating max updates', () => {
    it.todo(
      'should clamp values when max is reduced'
      // Setup: Create table, insert values 1, 3, 5, 7, 10
      // Execute: Run clamp statement with newMax = 5
      // Verify: Values are 1, 3, 5, 5, 5
    );

    it.todo(
      'should not modify values when max is increased'
      // Setup: Create table, insert values 1, 3, 5
      // Execute: Run any statement (should be no-op)
      // Verify: Values unchanged
    );

    it.todo(
      'should handle NULL values during clamp'
      // Setup: Create table, insert values 1, NULL, 10
      // Execute: Run clamp statement with newMax = 5
      // Verify: Values are 1, NULL, 5
    );

    it.todo(
      'should handle edge case where value equals new max'
      // Setup: Create table, insert value = 5
      // Execute: Run clamp with newMax = 5
      // Verify: Value unchanged (5)
    );
  });

  describe('User multiplicity updates', () => {
    it.todo(
      'should convert single user object to array (single -> multiple)'
      // Setup: Insert {"id": "usr1", "title": "User"}
      // Execute: Run jsonb_build_array statement
      // Verify: Value is [{"id": "usr1", "title": "User"}]
    );

    it.todo(
      'should extract first user from array (multiple -> single)'
      // Setup: Insert [{"id": "usr1"}, {"id": "usr2"}]
      // Execute: Run col->0 statement
      // Verify: Value is {"id": "usr1"}
    );

    it.todo(
      'should handle NULL values during multiplicity change'
      // Setup: Insert NULL
      // Execute: Run multiplicity change statement
      // Verify: Value remains NULL
    );

    it.todo(
      'should handle empty array for multiple -> single'
      // Setup: Insert []
      // Execute: Run col->0 statement
      // Verify: Value is NULL (array_length condition not met)
    );

    it.todo(
      'should preserve complete user object structure'
      // Setup: Insert complete user object with all fields
      // Execute: Run single -> multiple conversion
      // Verify: All fields preserved in array element
    );
  });

  describe('SingleSelect option updates', () => {
    it.todo(
      'should rename option values in records'
      // Setup: Insert records with 'Option A', 'Option B', 'Option A'
      // Execute: Run rename statement 'Option A' -> 'Renamed A'
      // Verify: Values are 'Renamed A', 'Option B', 'Renamed A'
    );

    it.todo(
      'should set removed option values to NULL'
      // Setup: Insert records with 'Keep', 'Delete', 'Keep'
      // Execute: Run removal statement for 'Delete'
      // Verify: Values are 'Keep', NULL, 'Keep'
    );

    it.todo(
      'should handle mixed operations (rename and remove)'
      // Setup: Insert records with various options
      // Execute: Run rename + removal statements
      // Verify: Renames applied, removed values are NULL
    );

    it.todo(
      'should not affect records with other option values'
      // Setup: Insert records with 'A', 'B', 'C'
      // Execute: Run rename for 'A' only
      // Verify: 'B' and 'C' unchanged
    );
  });

  describe('MultipleSelect option updates', () => {
    it.todo(
      'should rename option values within arrays'
      // Setup: Insert ['A', 'B'], ['A', 'C'], ['B', 'C']
      // Execute: Run array_replace for 'A' -> 'Renamed A'
      // Verify: ['Renamed A', 'B'], ['Renamed A', 'C'], ['B', 'C']
    );

    it.todo(
      'should remove option values from arrays'
      // Setup: Insert ['A', 'B', 'C'], ['A', 'B'], ['B', 'C']
      // Execute: Run array_remove for 'B'
      // Verify: ['A', 'C'], ['A'], ['C']
    );

    it.todo(
      'should handle arrays that become empty after removal'
      // Setup: Insert ['OnlyOption']
      // Execute: Run array_remove for 'OnlyOption'
      // Verify: [] (empty array)
    );

    it.todo(
      'should not affect records without the target option'
      // Setup: Insert ['X', 'Y'], ['A', 'B']
      // Execute: Run array_replace for 'A' -> 'Z'
      // Verify: ['X', 'Y'] unchanged, ['Z', 'B']
    );

    it.todo(
      'should handle multiple occurrences of same option in array'
      // Setup: Insert ['A', 'A', 'B']
      // Execute: Run array_replace for 'A' -> 'X'
      // Verify: ['X', 'X', 'B']
    );
  });

  describe('Field type conversion via visitor', () => {
    it.todo(
      'should successfully convert text field to number field'
      // Setup: Create table with text column, insert numeric strings
      // Execute: Run type conversion statements
      // Verify: Column is double precision, values converted
    );

    it.todo(
      'should successfully convert checkbox field to text field'
      // Setup: Create table with boolean column, insert TRUE/FALSE
      // Execute: Run type conversion statements
      // Verify: Column is text, values are 'true'/'false'
    );

    it.todo(
      'should handle failed conversions gracefully'
      // Setup: Create table with non-convertible data
      // Execute: Run type conversion statements
      // Verify: Invalid values become NULL
    );
  });

  describe('Complex scenarios', () => {
    it.todo(
      'should handle constraint changes with schema-qualified table name'
      // Setup: Create schema and table
      // Execute: Run constraint statements with schema prefix
      // Verify: Constraints applied to correct table
    );

    it.todo(
      'should handle concurrent constraint and data changes'
      // Setup: Create table with data
      // Execute: Multiple update statements in transaction
      // Verify: All changes applied atomically
    );

    it.todo(
      'should rollback on constraint violation'
      // Setup: Create table with data that would violate constraint
      // Execute: Attempt constraint addition in transaction
      // Verify: Transaction rolled back, table unchanged
    );
  });
});

describe('Link relationship conversion (PGlite)', () => {
  // IDs: prefix (3) + body (16) = 19 chars total
  const SRC_FIELD_ID = 'fldSrcField00000001';
  const SYM_FIELD_ID = 'fldSymField00000001';
  const FOREIGN_TBL_ID = 'tblForeignTbl000001';
  const LOOKUP_FLD_ID = 'fldLookupFld0000001';

  const SCHEMA = 'test_link_schema';
  const SOURCE_TBL = 'source_table';
  const FOREIGN_TBL = 'foreign_table';
  const JUNCTION_TBL = `junction_${SRC_FIELD_ID}_${SYM_FIELD_ID}`;

  const SELF_KEY = `__fk_${SYM_FIELD_ID}`;
  const FOREIGN_KEY = `__fk_${SRC_FIELD_ID}`;
  const ORDER_COL = `${SELF_KEY}_order`;

  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    db = new Kysely<V1TeableDatabase>({ dialect: new PGliteDialect(pglite) });
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(SCHEMA)}`.execute(db);
  });

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(SCHEMA)} CASCADE`.execute(db);
    await db.destroy();
  });

  afterEach(async () => {
    // Clean up all tables in test schema
    const result = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${SCHEMA}
    `.execute(db);
    for (const row of result.rows) {
      await sql`DROP TABLE IF EXISTS ${sql.id(SCHEMA)}.${sql.id(row.table_name)} CASCADE`.execute(
        db
      );
    }
  });

  const createConfig = (params: {
    relationship: string;
    isOneWay: boolean;
    fkHostTableName?: string;
    selfKeyName?: string;
    foreignKeyName?: string;
    symmetricFieldId?: string;
  }) => {
    return LinkFieldConfig.create({
      relationship: params.relationship,
      foreignTableId: FOREIGN_TBL_ID,
      lookupFieldId: LOOKUP_FLD_ID,
      isOneWay: params.isOneWay,
      fkHostTableName: params.fkHostTableName,
      selfKeyName: params.selfKeyName,
      foreignKeyName: params.foreignKeyName,
      symmetricFieldId: params.symmetricFieldId,
    })._unsafeUnwrap();
  };

  const createSpec = (params: {
    previousConfig: LinkFieldConfig;
    nextConfig: LinkFieldConfig;
    computedNextConfig?: LinkFieldConfig;
  }) => {
    const fieldId = FieldId.create(SRC_FIELD_ID)._unsafeUnwrap();
    const dbFieldName = DbFieldName.rehydrate('link_field')._unsafeUnwrap();
    const spec = UpdateLinkRelationshipSpec.create({
      fieldId,
      dbFieldName,
      previousConfig: params.previousConfig,
      nextConfig: params.nextConfig,
    });
    if (params.computedNextConfig) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (spec as any).computedNextConfigValue = params.computedNextConfig;
    }
    return spec;
  };

  const createVisitor = () =>
    new TableSchemaUpdateVisitor({
      db,
      schema: SCHEMA,
      tableName: SOURCE_TBL,
      tableId: SOURCE_TBL,
    });

  const executeStatements = async (spec: UpdateLinkRelationshipSpec) => {
    const visitor = createVisitor();
    const result = visitor.visitUpdateLinkRelationship(spec);
    expect(result.isOk()).toBe(true);
    const statements = result._unsafeUnwrap();
    for (const stmt of statements) {
      await db.executeQuery(stmt.compile(db));
    }
    return statements;
  };

  const tableExists = async (tableName: string): Promise<boolean> => {
    const result = await sql<{ cnt: string }>`
      SELECT count(*)::text as cnt FROM information_schema.tables
      WHERE table_schema = ${SCHEMA} AND table_name = ${tableName}
    `.execute(db);
    return result.rows[0]?.cnt === '1';
  };

  const columnInfo = async (
    tableName: string,
    columnName: string
  ): Promise<{ exists: boolean; dataType?: string }> => {
    const result = await sql<{ data_type: string }>`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = ${SCHEMA} AND table_name = ${tableName} AND column_name = ${columnName}
    `.execute(db);
    if (result.rows.length === 0) return { exists: false };
    return { exists: true, dataType: result.rows[0]!.data_type };
  };

  const indexInfo = async (
    tableName: string,
    indexName: string
  ): Promise<{ exists: boolean; isUnique?: boolean }> => {
    const result = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = ${SCHEMA} AND tablename = ${tableName} AND indexname = ${indexName}
    `.execute(db);
    const indexdef = result.rows[0]?.indexdef;
    if (!indexdef) return { exists: false };
    return { exists: true, isUnique: indexdef.includes('CREATE UNIQUE INDEX') };
  };

  const constraintExists = async (tableName: string, constraintName: string): Promise<boolean> => {
    const result = await sql<{ cnt: string }>`
      SELECT count(*)::text as cnt
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = ${SCHEMA}
        AND t.relname = ${tableName}
        AND c.conname = ${constraintName}
    `.execute(db);
    return result.rows[0]?.cnt === '1';
  };

  const createSourceAndForeignTables = async () => {
    await sql.raw(`CREATE TABLE "${SCHEMA}"."${SOURCE_TBL}" ("__id" TEXT PRIMARY KEY)`).execute(db);
    await sql
      .raw(`CREATE TABLE "${SCHEMA}"."${FOREIGN_TBL}" ("__id" TEXT PRIMARY KEY)`)
      .execute(db);
  };

  const createJunctionTableWithData = async () => {
    await sql
      .raw(
        `CREATE TABLE "${SCHEMA}"."${JUNCTION_TBL}" (
          "__id" SERIAL PRIMARY KEY,
          "${SELF_KEY}" TEXT,
          "${FOREIGN_KEY}" TEXT,
          "__order" DOUBLE PRECISION
        )`
      )
      .execute(db);

    // Insert source records
    await sql
      .raw(`INSERT INTO "${SCHEMA}"."${SOURCE_TBL}" VALUES ('rec1'), ('rec2'), ('rec3')`)
      .execute(db);
    // Insert foreign records
    await sql
      .raw(`INSERT INTO "${SCHEMA}"."${FOREIGN_TBL}" VALUES ('fRec1'), ('fRec2'), ('fRec3')`)
      .execute(db);
    // Insert junction data: rec1 → fRec1, rec2 → fRec2, rec3 → fRec3
    await sql
      .raw(
        `INSERT INTO "${SCHEMA}"."${JUNCTION_TBL}" ("${SELF_KEY}", "${FOREIGN_KEY}", "__order") VALUES
         ('rec1', 'fRec1', 1.0),
         ('rec2', 'fRec2', 2.0),
         ('rec3', 'fRec3', 3.0)`
      )
      .execute(db);
  };

  const createFkColumnWithData = async () => {
    await sql
      .raw(
        `ALTER TABLE "${SCHEMA}"."${FOREIGN_TBL}"
         ADD COLUMN "${SELF_KEY}" TEXT,
         ADD COLUMN "${ORDER_COL}" DOUBLE PRECISION`
      )
      .execute(db);

    // Insert source records
    await sql
      .raw(`INSERT INTO "${SCHEMA}"."${SOURCE_TBL}" VALUES ('rec1'), ('rec2'), ('rec3')`)
      .execute(db);
    // Insert foreign records with FK pointing back to source
    await sql
      .raw(
        `INSERT INTO "${SCHEMA}"."${FOREIGN_TBL}" ("__id", "${SELF_KEY}", "${ORDER_COL}") VALUES
         ('fRec1', 'rec1', 1.0),
         ('fRec2', 'rec2', 2.0),
         ('fRec3', 'rec3', 3.0)`
      )
      .execute(db);
  };

  describe('Junction → FK conversion (manyMany twoWay → oneMany twoWay)', () => {
    it('should drop junction table and create FK column on foreign table', async () => {
      await createSourceAndForeignTables();
      await createJunctionTableWithData();

      // Verify junction table exists before conversion
      expect(await tableExists(JUNCTION_TBL)).toBe(true);

      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const nextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({ previousConfig, nextConfig, computedNextConfig });
      await executeStatements(spec);

      // Junction table should no longer exist
      expect(await tableExists(JUNCTION_TBL)).toBe(false);
    });

    it('should create FK column with correct PG type (text)', async () => {
      await createSourceAndForeignTables();
      await createJunctionTableWithData();

      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      // FK column should exist on foreign table with type text
      const fkCol = await columnInfo(FOREIGN_TBL, SELF_KEY);
      expect(fkCol.exists).toBe(true);
      expect(fkCol.dataType).toBe('text');

      // Order column should exist with type double precision
      const orderCol = await columnInfo(FOREIGN_TBL, ORDER_COL);
      expect(orderCol.exists).toBe(true);
      expect(orderCol.dataType).toBe('double precision');
    });

    it('should preserve link data during migration', async () => {
      await createSourceAndForeignTables();
      await createJunctionTableWithData();

      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      // Verify data migrated: each foreign record should have the FK value from junction
      const rows = await sql<{ __id: string; fk: string | null }>`
        SELECT "__id", ${sql.ref(SELF_KEY)} as fk
        FROM ${sql.id(SCHEMA)}.${sql.id(FOREIGN_TBL)}
        ORDER BY "__id"
      `.execute(db);

      expect(rows.rows).toEqual([
        { __id: 'fRec1', fk: 'rec1' },
        { __id: 'fRec2', fk: 'rec2' },
        { __id: 'fRec3', fk: 'rec3' },
      ]);
    });

    it('should handle foreign records without junction entries (FK stays NULL)', async () => {
      await createSourceAndForeignTables();

      // Create junction with only partial data
      await sql
        .raw(
          `CREATE TABLE "${SCHEMA}"."${JUNCTION_TBL}" (
            "__id" SERIAL PRIMARY KEY,
            "${SELF_KEY}" TEXT,
            "${FOREIGN_KEY}" TEXT,
            "__order" DOUBLE PRECISION
          )`
        )
        .execute(db);

      await sql.raw(`INSERT INTO "${SCHEMA}"."${SOURCE_TBL}" VALUES ('rec1')`).execute(db);
      await sql
        .raw(`INSERT INTO "${SCHEMA}"."${FOREIGN_TBL}" VALUES ('fRec1'), ('fRec2')`)
        .execute(db);
      // Only fRec1 is linked
      await sql
        .raw(
          `INSERT INTO "${SCHEMA}"."${JUNCTION_TBL}" ("${SELF_KEY}", "${FOREIGN_KEY}") VALUES ('rec1', 'fRec1')`
        )
        .execute(db);

      const previousConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      const rows = await sql<{ __id: string; fk: string | null }>`
        SELECT "__id", ${sql.ref(SELF_KEY)} as fk
        FROM ${sql.id(SCHEMA)}.${sql.id(FOREIGN_TBL)}
        ORDER BY "__id"
      `.execute(db);

      expect(rows.rows).toEqual([
        { __id: 'fRec1', fk: 'rec1' },
        { __id: 'fRec2', fk: null },
      ]);
    });
  });

  describe('FK → Junction conversion (oneMany twoWay → manyMany twoWay)', () => {
    it('should create junction table and drop FK column from foreign table', async () => {
      await createSourceAndForeignTables();
      await createFkColumnWithData();

      // Verify FK column exists before conversion
      expect((await columnInfo(FOREIGN_TBL, SELF_KEY)).exists).toBe(true);
      expect(await tableExists(JUNCTION_TBL)).toBe(false);

      const previousConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      // Junction table should now exist
      expect(await tableExists(JUNCTION_TBL)).toBe(true);

      // FK column should no longer exist on foreign table
      expect((await columnInfo(FOREIGN_TBL, SELF_KEY)).exists).toBe(false);

      // Order column should no longer exist on foreign table
      expect((await columnInfo(FOREIGN_TBL, ORDER_COL)).exists).toBe(false);
    });

    it('should create junction table with correct column types', async () => {
      await createSourceAndForeignTables();
      await createFkColumnWithData();

      const previousConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      // Check junction table columns
      const selfKeyCol = await columnInfo(JUNCTION_TBL, SELF_KEY);
      expect(selfKeyCol.exists).toBe(true);
      expect(selfKeyCol.dataType).toBe('text');

      const foreignKeyCol = await columnInfo(JUNCTION_TBL, FOREIGN_KEY);
      expect(foreignKeyCol.exists).toBe(true);
      expect(foreignKeyCol.dataType).toBe('text');

      const orderCol = await columnInfo(JUNCTION_TBL, '__order');
      expect(orderCol.exists).toBe(true);
      expect(orderCol.dataType).toBe('double precision');

      const idCol = await columnInfo(JUNCTION_TBL, '__id');
      expect(idCol.exists).toBe(true);
      expect(idCol.dataType).toBe('integer');
    });

    it('should preserve link data during migration', async () => {
      await createSourceAndForeignTables();
      await createFkColumnWithData();

      const previousConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      // Verify data migrated: junction should contain the FK data
      const rows = await sql<{ self_key: string; foreign_key: string }>`
        SELECT ${sql.ref(SELF_KEY)} as self_key, ${sql.ref(FOREIGN_KEY)} as foreign_key
        FROM ${sql.id(SCHEMA)}.${sql.id(JUNCTION_TBL)}
        ORDER BY ${sql.ref(SELF_KEY)}
      `.execute(db);

      expect(rows.rows).toEqual([
        { self_key: 'rec1', foreign_key: 'fRec1' },
        { self_key: 'rec2', foreign_key: 'fRec2' },
        { self_key: 'rec3', foreign_key: 'fRec3' },
      ]);
    });

    it('should skip NULL FK values during migration', async () => {
      await createSourceAndForeignTables();

      await sql
        .raw(
          `ALTER TABLE "${SCHEMA}"."${FOREIGN_TBL}"
           ADD COLUMN "${SELF_KEY}" TEXT,
           ADD COLUMN "${ORDER_COL}" DOUBLE PRECISION`
        )
        .execute(db);

      // fRec2 has no link (NULL FK)
      await sql
        .raw(
          `INSERT INTO "${SCHEMA}"."${FOREIGN_TBL}" ("__id", "${SELF_KEY}") VALUES
           ('fRec1', 'rec1'),
           ('fRec2', NULL),
           ('fRec3', 'rec3')`
        )
        .execute(db);

      const previousConfig = createConfig({
        relationship: 'oneMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${FOREIGN_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: '__id',
        symmetricFieldId: SYM_FIELD_ID,
      });
      const computedNextConfig = createConfig({
        relationship: 'manyMany',
        isOneWay: false,
        fkHostTableName: `${SCHEMA}.${JUNCTION_TBL}`,
        selfKeyName: SELF_KEY,
        foreignKeyName: FOREIGN_KEY,
        symmetricFieldId: SYM_FIELD_ID,
      });

      const spec = createSpec({
        previousConfig,
        nextConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig,
      });
      await executeStatements(spec);

      // Only non-NULL FK rows should be in junction table
      const rows = await sql<{ self_key: string; foreign_key: string }>`
        SELECT ${sql.ref(SELF_KEY)} as self_key, ${sql.ref(FOREIGN_KEY)} as foreign_key
        FROM ${sql.id(SCHEMA)}.${sql.id(JUNCTION_TBL)}
        ORDER BY ${sql.ref(SELF_KEY)}
      `.execute(db);

      expect(rows.rows).toHaveLength(2);
      expect(rows.rows).toEqual([
        { self_key: 'rec1', foreign_key: 'fRec1' },
        { self_key: 'rec3', foreign_key: 'fRec3' },
      ]);
    });
  });

  describe('FK-only relationship conversion', () => {
    it('should replace oneOne unique FK constraint when converting to manyOne', async () => {
      await createSourceAndForeignTables();

      await sql
        .raw(
          `ALTER TABLE "${SCHEMA}"."${SOURCE_TBL}"
           ADD COLUMN "${FOREIGN_KEY}" TEXT,
           ADD COLUMN "${FOREIGN_KEY}_order" DOUBLE PRECISION`
        )
        .execute(db);
      await sql
        .raw(
          `ALTER TABLE "${SCHEMA}"."${SOURCE_TBL}"
           ADD CONSTRAINT "index_${FOREIGN_KEY}" UNIQUE ("${FOREIGN_KEY}")`
        )
        .execute(db);
      await sql
        .raw(
          `INSERT INTO "${SCHEMA}"."${SOURCE_TBL}" ("__id", "${FOREIGN_KEY}") VALUES
           ('rec1', 'fRec1'),
           ('rec2', NULL)`
        )
        .execute(db);

      expect(await indexInfo(SOURCE_TBL, `index_${FOREIGN_KEY}`)).toEqual({
        exists: true,
        isUnique: true,
      });
      await expect(constraintExists(SOURCE_TBL, `index_${FOREIGN_KEY}`)).resolves.toBe(true);

      const spec = createSpec({
        previousConfig: createConfig({
          relationship: 'oneOne',
          isOneWay: false,
          fkHostTableName: `${SCHEMA}.${SOURCE_TBL}`,
          selfKeyName: '__id',
          foreignKeyName: FOREIGN_KEY,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        nextConfig: createConfig({
          relationship: 'manyOne',
          isOneWay: false,
          fkHostTableName: `${SCHEMA}.${SOURCE_TBL}`,
          selfKeyName: '__id',
          foreignKeyName: FOREIGN_KEY,
          symmetricFieldId: SYM_FIELD_ID,
        }),
      });

      await executeStatements(spec);

      expect(await indexInfo(SOURCE_TBL, `index_${FOREIGN_KEY}`)).toEqual({
        exists: true,
        isUnique: false,
      });
      await expect(constraintExists(SOURCE_TBL, `index_${FOREIGN_KEY}`)).resolves.toBe(false);

      await expect(
        sql
          .raw(
            `UPDATE "${SCHEMA}"."${SOURCE_TBL}" SET "${FOREIGN_KEY}" = 'fRec1' WHERE "__id" = 'rec2'`
          )
          .execute(db)
      ).resolves.toBeDefined();
    });
  });

  describe('Round-trip conversion', () => {
    it('should preserve data through junction → FK → junction round-trip', async () => {
      await createSourceAndForeignTables();
      await createJunctionTableWithData();

      const junctionFkHostTable = `${SCHEMA}.${JUNCTION_TBL}`;
      const foreignFkHostTable = `${SCHEMA}.${FOREIGN_TBL}`;

      // Step 1: Junction → FK
      const step1Spec = createSpec({
        previousConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          fkHostTableName: junctionFkHostTable,
          selfKeyName: SELF_KEY,
          foreignKeyName: FOREIGN_KEY,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        nextConfig: createConfig({
          relationship: 'oneMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig: createConfig({
          relationship: 'oneMany',
          isOneWay: false,
          fkHostTableName: foreignFkHostTable,
          selfKeyName: SELF_KEY,
          foreignKeyName: '__id',
          symmetricFieldId: SYM_FIELD_ID,
        }),
      });
      await executeStatements(step1Spec);

      // Verify intermediate state
      expect(await tableExists(JUNCTION_TBL)).toBe(false);
      expect((await columnInfo(FOREIGN_TBL, SELF_KEY)).exists).toBe(true);

      // Step 2: FK → Junction
      const step2Spec = createSpec({
        previousConfig: createConfig({
          relationship: 'oneMany',
          isOneWay: false,
          fkHostTableName: foreignFkHostTable,
          selfKeyName: SELF_KEY,
          foreignKeyName: '__id',
          symmetricFieldId: SYM_FIELD_ID,
        }),
        nextConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          symmetricFieldId: SYM_FIELD_ID,
        }),
        computedNextConfig: createConfig({
          relationship: 'manyMany',
          isOneWay: false,
          fkHostTableName: junctionFkHostTable,
          selfKeyName: SELF_KEY,
          foreignKeyName: FOREIGN_KEY,
          symmetricFieldId: SYM_FIELD_ID,
        }),
      });
      await executeStatements(step2Spec);

      // Verify final state matches original
      expect(await tableExists(JUNCTION_TBL)).toBe(true);
      expect((await columnInfo(FOREIGN_TBL, SELF_KEY)).exists).toBe(false);

      const rows = await sql<{ self_key: string; foreign_key: string }>`
        SELECT ${sql.ref(SELF_KEY)} as self_key, ${sql.ref(FOREIGN_KEY)} as foreign_key
        FROM ${sql.id(SCHEMA)}.${sql.id(JUNCTION_TBL)}
        ORDER BY ${sql.ref(SELF_KEY)}
      `.execute(db);

      expect(rows.rows).toEqual([
        { self_key: 'rec1', foreign_key: 'fRec1' },
        { self_key: 'rec2', foreign_key: 'fRec2' },
        { self_key: 'rec3', foreign_key: 'fRec3' },
      ]);
    });
  });
});

describe('Managed search vector column drop (PGlite)', () => {
  const SCHEMA = 'test_search_vector_schema';
  const TABLE_ID = `tbl${'d'.repeat(16)}`;
  const FIELD_ID = `fld${'d'.repeat(16)}`;

  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    db = new Kysely<V1TeableDatabase>({ dialect: new PGliteDialect(pglite) });
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(SCHEMA)}`.execute(db);
    await ensureSearchMetadataTables(db);
  });

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(SCHEMA)} CASCADE`.execute(db);
    await db.destroy();
  });

  // The maintenance statements only run for a field that a configured document
  // covers; these tests pin the physical DDL itself, so they configure the
  // document to cover the field under test.
  const seedConfiguredDocument = async (fieldIds: readonly string[]): Promise<void> => {
    await sql`DELETE FROM public.table_query_search_vector_config`.execute(db);
    await sql`
      INSERT INTO public.table_query_search_vector_config (
        "table_id", "candidate_key", "status", "field_ids", "last_modified_time"
      )
      VALUES (${TABLE_ID}, 'candidate:pg_bigm', 'ready', ${JSON.stringify(fieldIds)}::jsonb, now())
    `.execute(db);
  };

  const buildVisitor = (tableName: string): TableSchemaUpdateVisitor => {
    const fieldId = FieldId.create(FIELD_ID)._unsafeUnwrap();
    const builder = Table.builder()
      .withId(TableId.create(TABLE_ID)._unsafeUnwrap())
      .withBaseId(BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Search Vector Drop')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    return new TableSchemaUpdateVisitor({
      db,
      schema: SCHEMA,
      tableName,
      tableId: table.id().toString(),
      table,
    });
  };

  const executeDropStatement = async (
    visitor: TableSchemaUpdateVisitor,
    fieldId: string
  ): Promise<void> =>
    executeSchemaStatement(
      (
        visitor as unknown as {
          dropManagedSearchVectorColumnsStatement(fieldId: string): ExecutableSchemaStatement;
        }
      ).dropManagedSearchVectorColumnsStatement(fieldId),
      { dataDb: db, metaDb: db }
    );

  it('is a no-op on tables without managed search columns', async () => {
    // Regression: the string_agg form always returns one row, and format()
    // renders a NULL %s as '', so testing the fully-formatted statement for
    // NULL executed a bare "ALTER TABLE schema.table " (42601) on every
    // table without managed columns — breaking field delete outright.
    await seedConfiguredDocument([FIELD_ID]);
    await sql`CREATE TABLE ${sql.id(SCHEMA)}."tbl_plain" ("__id" text PRIMARY KEY, "name" text)`.execute(
      db
    );

    await expect(
      executeDropStatement(buildVisitor('tbl_plain'), FIELD_ID)
    ).resolves.toBeUndefined();

    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${SCHEMA} AND table_name = 'tbl_plain'
    `.execute(db);
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(['__id', 'name']);
  });

  it('drops every managed generated search column and keeps user columns', async () => {
    await seedConfiguredDocument([FIELD_ID]);
    await sql`
      CREATE TABLE ${sql.id(SCHEMA)}."tbl_managed" (
        "__id" text PRIMARY KEY,
        "name" text,
        "__tqops_tsv_doc1" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", ''))) STORED,
        "__tqops_search_doc2" text GENERATED ALWAYS AS (coalesce("name", '')) STORED,
        "user_generated" text GENERATED ALWAYS AS (upper("name")) STORED
      )
    `.execute(db);

    await executeDropStatement(buildVisitor('tbl_managed'), FIELD_ID);

    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${SCHEMA} AND table_name = 'tbl_managed'
    `.execute(db);
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      '__id',
      'name',
      'user_generated',
    ]);
  });

  it('keeps managed columns when no configured document covers the field', async () => {
    await seedConfiguredDocument([`fld${'f'.repeat(16)}`]);
    await sql`
      CREATE TABLE ${sql.id(SCHEMA)}."tbl_unrelated" (
        "__id" text PRIMARY KEY,
        "name" text,
        "__tqops_search_doc" text GENERATED ALWAYS AS (coalesce("name", '')) STORED
      )
    `.execute(db);

    await executeDropStatement(buildVisitor('tbl_unrelated'), FIELD_ID);

    const columns = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${SCHEMA} AND table_name = 'tbl_unrelated'
    `.execute(db);
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      '__id',
      '__tqops_search_doc',
      'name',
    ]);
  });
});

describe('Search document survives removing a field outside its contract (PGlite)', () => {
  const SCHEMA = 'test_search_vector_field_removal';
  const TABLE_NAME = `tbl_${'c'.repeat(16)}`;
  const TABLE_ID = `tbl${'c'.repeat(16)}`;
  const BASE_ID = `bse${'c'.repeat(16)}`;
  const COVERED_FIELD = createTextField('c', 'Name', 'Name')._unsafeUnwrap();
  const OTHER_FIELD = createTextField('e', 'Note', 'Note')._unsafeUnwrap();
  const COVERED_FIELD_ID = COVERED_FIELD.id().toString();
  const OTHER_FIELD_ID = OTHER_FIELD.id().toString();

  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    db = new Kysely<V1TeableDatabase>({ dialect: new PGliteDialect(pglite) });
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(SCHEMA)}`.execute(db);
    await ensureSearchMetadataTables(db);
  });

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(SCHEMA)} CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS public.table_query_search_vector_config`.execute(db);
    await sql`DROP TABLE IF EXISTS public.table_meta`.execute(db);
    await db.destroy();
  });

  const buildTable = (): Table =>
    Table.rehydrate({
      id: TableId.create(TABLE_ID)._unsafeUnwrap(),
      baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
      name: TableName.create('Field Removal')._unsafeUnwrap(),
      fields: [COVERED_FIELD, OTHER_FIELD],
      views: [],
      primaryFieldId: FieldId.create(COVERED_FIELD_ID)._unsafeUnwrap(),
    })._unsafeUnwrap();

  const createPhysicalTable = async (documentSource: 'Name' | 'Note'): Promise<void> => {
    await sql`DROP TABLE IF EXISTS ${sql.id(SCHEMA)}.${sql.id(TABLE_NAME)}`.execute(db);
    await sql`
      CREATE TABLE ${sql.id(SCHEMA)}.${sql.id(TABLE_NAME)} (
        "__id" text PRIMARY KEY,
        "Name" text,
        "Note" text,
        "__tqops_search_doc" text GENERATED ALWAYS AS
          (coalesce(${sql.raw(`"${documentSource}"`)}, '')) STORED
      )
    `.execute(db);
  };

  const seedServingMetadata = async (
    configuredFieldIds: readonly string[] | null
  ): Promise<void> => {
    await sql`DELETE FROM public.table_meta`.execute(db);
    await sql`DELETE FROM public.table_query_search_vector_config`.execute(db);
    await sql`
      INSERT INTO public.table_meta ("id", "search_index", "version")
      VALUES (
        ${TABLE_ID},
        ${JSON.stringify({ version: 1, indexUsable: true, provider: 'pg_bigm' })}::jsonb,
        7
      )
    `.execute(db);
    await sql`
      INSERT INTO public.table_query_search_vector_config (
        "table_id", "candidate_key", "status", "field_ids", "last_modified_time"
      )
      VALUES (
        ${TABLE_ID},
        'candidate:pg_bigm',
        'ready',
        ${
          configuredFieldIds === null
            ? sql`NULL`
            : sql`${JSON.stringify(configuredFieldIds)}::jsonb`
        },
        now()
      )
    `.execute(db);
  };

  const removeField = async (
    fieldId: string,
    metaDb: Kysely<V1TeableDatabase> = db
  ): Promise<void> => {
    const table = buildTable();
    const removedResult = table.getField((candidate) => candidate.id().toString() === fieldId);
    if (removedResult.isErr()) {
      throw new Error(`getField failed: ${JSON.stringify(removedResult.error)}`);
    }
    const visitor = new TableSchemaUpdateVisitor({
      db,
      schema: SCHEMA,
      tableName: TABLE_NAME,
      tableId: TABLE_ID,
      table,
    });
    const statementsResult = visitor.visitTableRemoveField(
      TableRemoveFieldSpec.create(removedResult.value)
    );
    if (statementsResult.isErr()) {
      throw new Error(`visitTableRemoveField failed: ${JSON.stringify(statementsResult.error)}`);
    }
    for (const statement of statementsResult.value) {
      await executeSchemaStatement(statement as unknown as ExecutableSchemaStatement, {
        dataDb: db,
        metaDb,
      });
    }
  };

  const managedDocumentColumns = async (): Promise<string[]> => {
    const result = await sql<{ attname: string }>`
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${SCHEMA}
        AND c.relname = ${TABLE_NAME}
        AND a.attgenerated = 's'
        AND a.attname LIKE '%tqops%'
    `.execute(db);
    return result.rows.map((row) => row.attname);
  };

  const readServingMetadata = async (): Promise<{
    searchIndex: unknown;
    version: number;
    status: string;
    lastInspection: unknown;
  }> => {
    const meta = await sql<{ search_index: unknown; version: number }>`
      SELECT "search_index", "version" FROM public.table_meta WHERE "id" = ${TABLE_ID}
    `.execute(db);
    const config = await sql<{ status: string; last_inspection: unknown }>`
      SELECT "status", "last_inspection"
      FROM public.table_query_search_vector_config
      WHERE "table_id" = ${TABLE_ID}
    `.execute(db);
    return {
      searchIndex: meta.rows[0]?.search_index ?? null,
      version: Number(meta.rows[0]?.version ?? 0),
      status: config.rows[0]?.status ?? '',
      lastInspection: config.rows[0]?.last_inspection ?? null,
    };
  };

  it('keeps the document and its serving metadata when the removed field is not covered', async () => {
    // Regression: a field added after the document was built is outside the
    // document's coverage, yet removing it used to drop the whole document and
    // unpublish the serving snapshot, pushing search back to ILIKE.
    await createPhysicalTable('Name');
    await seedServingMetadata([COVERED_FIELD_ID]);

    await removeField(OTHER_FIELD_ID);

    expect(await managedDocumentColumns()).toEqual(['__tqops_search_doc']);
    const metadata = await readServingMetadata();
    expect(metadata.searchIndex).not.toBeNull();
    expect(metadata.version).toBe(7);
    expect(metadata.status).toBe('ready');
  });

  it('drops the document and unpublishes serving metadata when the removed field is covered', async () => {
    await createPhysicalTable('Note');
    await seedServingMetadata([OTHER_FIELD_ID]);

    await removeField(OTHER_FIELD_ID);

    expect(await managedDocumentColumns()).toEqual([]);
    const metadata = await readServingMetadata();
    expect(metadata.searchIndex).toBeNull();
    expect(metadata.version).toBe(8);
    expect(metadata.status).toBe('rebuild_pending');
    expect(metadata.lastInspection).toMatchObject({
      state: 'rebuild_pending',
      staleReasons: ['source_field_removed'],
    });
  });

  it('retires the document when the recorded coverage is an empty field list', async () => {
    // An empty list cannot prove the document is unrelated to the field, so the
    // conservative path retires it.
    await createPhysicalTable('Name');
    await seedServingMetadata([]);

    await removeField(OTHER_FIELD_ID);

    expect(await managedDocumentColumns()).toEqual([]);
    const metadata = await readServingMetadata();
    expect(metadata.searchIndex).toBeNull();
    expect(metadata.version).toBe(8);
  });

  it('retires the document when the table has no recorded search configuration', async () => {
    // No contract means nothing proves the document is unrelated to the field,
    // so the conservative path still retires it (and unpublishes it).
    await createPhysicalTable('Name');
    await seedServingMetadata([COVERED_FIELD_ID]);
    await sql`DELETE FROM public.table_query_search_vector_config`.execute(db);

    await expect(removeField(OTHER_FIELD_ID)).resolves.toBeUndefined();

    expect(await managedDocumentColumns()).toEqual([]);
    const metadata = await readServingMetadata();
    expect(metadata.searchIndex).toBeNull();
    expect(metadata.version).toBe(8);
  });

  it('retires the document when the recorded coverage is unknown', async () => {
    // Unknown coverage (no recorded field ids) falls back to the conservative
    // retire-and-rebuild path instead of assuming no document depends on the
    // column.
    await createPhysicalTable('Name');
    await seedServingMetadata(null);

    await removeField(OTHER_FIELD_ID);

    expect(await managedDocumentColumns()).toEqual([]);
    const metadata = await readServingMetadata();
    expect(metadata.searchIndex).toBeNull();
    expect(metadata.status).toBe('rebuild_pending');
  });

  it('keeps the legacy retire path when the configuration table does not exist', async () => {
    // The contract cannot be read, so the document is retired as before instead
    // of assuming no document depends on the removed field's column.
    await createPhysicalTable('Name');
    await seedServingMetadata([COVERED_FIELD_ID]);
    await sql`ALTER TABLE public.table_query_search_vector_config RENAME TO table_query_search_vector_config_hidden`.execute(
      db
    );
    try {
      await expect(removeField(OTHER_FIELD_ID)).resolves.toBeUndefined();

      expect(await managedDocumentColumns()).toEqual([]);
      const meta = await sql<{ search_index: unknown; version: number }>`
        SELECT "search_index", "version" FROM public.table_meta WHERE "id" = ${TABLE_ID}
      `.execute(db);
      expect(meta.rows[0]?.search_index).toBeNull();
      expect(Number(meta.rows[0]?.version)).toBe(8);
    } finally {
      await sql`ALTER TABLE table_query_search_vector_config_hidden RENAME TO table_query_search_vector_config`.execute(
        db
      );
    }
  });
});

describe('Managed search document across separate metadata and data planes (PGlite)', () => {
  const SCHEMA = 'test_search_vector_split_plane';
  const TABLE_NAME = `tbl_${'a'.repeat(16)}`;
  const TABLE_ID = `tbl${'a'.repeat(16)}`;
  const BASE_ID = `bse${'a'.repeat(16)}`;
  const COVERED_FIELD = createTextField('a', 'Name', 'Name')._unsafeUnwrap();
  const OTHER_FIELD = createTextField('b', 'Note', 'Note')._unsafeUnwrap();
  const COVERED_FIELD_ID = COVERED_FIELD.id().toString();
  const OTHER_FIELD_ID = OTHER_FIELD.id().toString();

  let dataPglite: PGlite;
  let metaPglite: PGlite;
  let dataDb: Kysely<V1TeableDatabase>;
  let metaDb: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    dataPglite = new PGlite();
    metaPglite = new PGlite();
    await Promise.all([dataPglite.waitReady, metaPglite.waitReady]);
    dataDb = new Kysely<V1TeableDatabase>({ dialect: new PGliteDialect(dataPglite) });
    metaDb = new Kysely<V1TeableDatabase>({ dialect: new PGliteDialect(metaPglite) });
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(SCHEMA)}`.execute(dataDb);
    // The data plane never holds the management tables; byodb spaces split them.
    await ensureSearchMetadataTables(metaDb);
  });

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(SCHEMA)} CASCADE`.execute(dataDb);
    await dataDb.destroy();
    await sql`DROP TABLE IF EXISTS public.table_query_search_vector_config`.execute(metaDb);
    await sql`DROP TABLE IF EXISTS public.table_meta`.execute(metaDb);
    await metaDb.destroy();
  });

  const createPhysicalTable = async (documentSource: 'Name' | 'Note'): Promise<void> => {
    await sql`DROP TABLE IF EXISTS ${sql.id(SCHEMA)}.${sql.id(TABLE_NAME)}`.execute(dataDb);
    await sql`
      CREATE TABLE ${sql.id(SCHEMA)}.${sql.id(TABLE_NAME)} (
        "__id" text PRIMARY KEY,
        "Name" text,
        "Note" text,
        "__tqops_search_doc" text GENERATED ALWAYS AS
          (coalesce(${sql.raw(`"${documentSource}"`)}, '')) STORED
      )
    `.execute(dataDb);
  };

  const seedServingMetadata = async (configuredFieldIds: readonly string[]): Promise<void> => {
    await sql`DELETE FROM public.table_meta`.execute(metaDb);
    await sql`DELETE FROM public.table_query_search_vector_config`.execute(metaDb);
    await sql`
      INSERT INTO public.table_meta ("id", "search_index", "version")
      VALUES (
        ${TABLE_ID},
        ${JSON.stringify({ version: 1, indexUsable: true, provider: 'pg_bigm' })}::jsonb,
        7
      )
    `.execute(metaDb);
    await sql`
      INSERT INTO public.table_query_search_vector_config (
        "table_id", "candidate_key", "status", "field_ids", "last_modified_time"
      )
      VALUES (${TABLE_ID}, 'candidate:pg_bigm', 'ready', ${JSON.stringify(
        configuredFieldIds
      )}::jsonb, now())
    `.execute(metaDb);
  };

  const removeField = async (fieldId: string): Promise<void> => {
    const table = Table.rehydrate({
      id: TableId.create(TABLE_ID)._unsafeUnwrap(),
      baseId: BaseId.create(BASE_ID)._unsafeUnwrap(),
      name: TableName.create('Split Plane')._unsafeUnwrap(),
      fields: [COVERED_FIELD, OTHER_FIELD],
      views: [],
      primaryFieldId: FieldId.create(COVERED_FIELD_ID)._unsafeUnwrap(),
    })._unsafeUnwrap();
    const removed = table
      .getField((candidate) => candidate.id().toString() === fieldId)
      ._unsafeUnwrap();
    const visitor = new TableSchemaUpdateVisitor({
      db: dataDb,
      schema: SCHEMA,
      tableName: TABLE_NAME,
      tableId: TABLE_ID,
      table,
    });
    const statements = visitor
      .visitTableRemoveField(TableRemoveFieldSpec.create(removed))
      ._unsafeUnwrap();
    for (const statement of statements) {
      await executeSchemaStatement(statement as unknown as ExecutableSchemaStatement, {
        dataDb,
        metaDb,
      });
    }
  };

  const managedDocumentColumns = async (): Promise<string[]> => {
    const result = await sql<{ attname: string }>`
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${SCHEMA}
        AND c.relname = ${TABLE_NAME}
        AND a.attgenerated = 's'
        AND a.attname LIKE '%tqops%'
    `.execute(dataDb);
    return result.rows.map((row) => row.attname);
  };

  const servingSnapshot = async (): Promise<unknown> =>
    (
      await sql<{ search_index: unknown }>`
        SELECT search_index FROM public.table_meta WHERE id = ${TABLE_ID}
      `.execute(metaDb)
    ).rows[0]?.search_index ?? null;

  it('keeps the document when the data plane cannot see the metadata contract', async () => {
    // Regression: reading coverage on the data handle made a byodb data plane
    // (no management tables) fall back to the unconditional drop while the
    // metadata plane kept the published snapshot, leaving search queries
    // pointing at a dropped column.
    await createPhysicalTable('Name');
    await seedServingMetadata([COVERED_FIELD_ID]);

    await removeField(OTHER_FIELD_ID);

    expect(await managedDocumentColumns()).toEqual(['__tqops_search_doc']);
    expect(await servingSnapshot()).toMatchObject({ indexUsable: true, provider: 'pg_bigm' });
  });

  it('retires the document and the snapshot when a covered field is removed', async () => {
    await createPhysicalTable('Note');
    await seedServingMetadata([OTHER_FIELD_ID]);

    await removeField(OTHER_FIELD_ID);

    expect(await managedDocumentColumns()).toEqual([]);
    expect(await servingSnapshot()).toBeNull();
  });
});
