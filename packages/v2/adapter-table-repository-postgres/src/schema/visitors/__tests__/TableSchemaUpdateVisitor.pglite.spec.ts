/**
 * Integration tests for TableSchemaUpdateVisitor using PGlite.
 *
 * These tests validate that the generated SQL statements actually work
 * against a real PostgreSQL-compatible database using PGlite.
 */
import { PGlite } from '@electric-sql/pglite';
import { DbFieldName, FieldId, LinkFieldConfig, UpdateLinkRelationshipSpec } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Kysely, sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { TableSchemaUpdateVisitor } from '../TableSchemaUpdateVisitor';
import { PGliteDialect } from './helpers/createPGliteDb';

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
