/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * Unit tests for Schema Rules using PGlite.
 *
 * These tests verify that:
 * 1. up() creates the expected schema elements and isValid() returns true
 * 2. down() removes the schema elements and isValid() returns false (for most rules)
 */
import { PGlite } from '@electric-sql/pglite';
import type { DomainError, Field, LinkField } from '@teable/v2-core';
import {
  BaseId,
  createConditionalLookupFieldPending,
  createCreatedTimeField,
  createLinkField,
  createMultipleSelectField,
  createLookupFieldPending,
  createSingleSelectField,
  createSingleLineTextField,
  ConditionalLookupOptions,
  DbFieldName,
  DbTableName,
  FieldId,
  LinkFieldConfig,
  LinkFieldMeta,
  FieldName,
  FieldNotNull,
  FieldUnique,
  GeneratedColumnMeta,
  LookupOptions,
  SelectOption,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Dialect, QueryResult } from 'kysely';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ComputedFieldBackfillService } from '../../../record/computed/ComputedFieldBackfillService';
import { createSchemaChecker } from '../checker/SchemaChecker';
import type { SchemaCheckResult } from '../checker/SchemaCheckResult';
import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import type { SchemaIntrospector } from '../context/SchemaIntrospector';
import type { SchemaRuleContext } from '../context/SchemaRuleContext';
import { createSchemaRepairer } from '../repairer/SchemaRepairer';
import type { SchemaRepairResult } from '../repairer/SchemaRepairResult';
import { SYSTEM_RULE_FIELD_ID } from '../table/SystemTableRules';
import { ColumnExistsRule } from './ColumnExistsRule';
import { ColumnUniqueConstraintRule } from './ColumnUniqueConstraintRule';
import { FieldMetaRule } from './FieldMetaRule';
import { createFieldSchemaRules } from './FieldSchemaRulesFactory';
import { FkColumnRule } from './FkColumnRule';
import { ForeignKeyRule } from './ForeignKeyRule';
import { GeneratedColumnMetaRule } from './GeneratedColumnMetaRule';
import { GeneratedColumnRule } from './GeneratedColumnRule';
import { IndexRule } from './IndexRule';
import type { JunctionTableConfig } from './JunctionTableRule';
import {
  JunctionTableExistsRule,
  JunctionTableForeignKeyRule,
  JunctionTableIndexRule,
  JunctionTableUniqueConstraintRule,
} from './JunctionTableRule';
import { LinkSymmetricFieldRule } from './LinkSymmetricFieldRule';
import { LinkValueColumnRule } from './LinkValueColumnRule';
import { NotNullConstraintRule } from './NotNullConstraintRule';
import { OrderColumnRule } from './OrderColumnRule';
import { ReferenceRule } from './ReferenceRule';
import { SelectOptionsMetaRule } from './SelectOptionsMetaRule';
import { UniqueIndexRule } from './UniqueIndexRule';

const TEST_SCHEMA = 'test_schema';

// PGlite Kysely dialect implementation
class PGliteDriver {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async acquireConnection() {
    return new PGliteConnection(this.#client);
  }

  async beginTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
  }

  async commitTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
  }

  async rollbackTransaction(connection: PGliteConnection) {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
  }

  async destroy() {
    await this.#client.close();
  }

  async init() {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async releaseConnection(_connection: PGliteConnection) {}
}

class PGliteConnection {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#client.query<R>(compiledQuery.sql, [...compiledQuery.parameters]);
    return {
      rows: result.rows,
      numAffectedRows: result.affectedRows ? BigInt(result.affectedRows) : undefined,
    };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery(): AsyncGenerator<never> {
    throw new Error('PGlite does not support streaming.');
  }
}

class KyselyPGliteDialect implements Dialect {
  #client: PGlite;

  constructor(client: PGlite) {
    this.#client = client;
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver() {
    return new PGliteDriver(this.#client);
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

/**
 * Create a valid field ID (format: fld + 16 chars)
 */
// eslint-disable-next-line regexp/use-ignore-case
const sanitizeIdSeed = (seed: string): string => seed.replace(/[^0-9a-zA-Z]/g, '0');
const createValidFieldId = (seed: string): string =>
  `fld${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;
const createValidTableId = (seed: string): string =>
  `tbl${sanitizeIdSeed(seed).padEnd(16, '0').slice(0, 16)}`;

/**
 * Helper to create a real field with dbFieldName set
 */
const createRealField = (
  id: string,
  name: string,
  dbFieldName: string,
  options: { notNull?: boolean; unique?: boolean } = {}
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const notNull = options.notNull ? FieldNotNull.required() : FieldNotNull.optional();
  const unique = options.unique ? FieldUnique.enabled() : FieldUnique.disabled();

  const fieldResult = createSingleLineTextField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    notNull,
    unique,
  });

  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createRealFieldWithFieldId = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(id);
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const fieldResult = createSingleLineTextField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    notNull: FieldNotNull.optional(),
    unique: FieldUnique.disabled(),
  });

  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createCreatedTimeFieldWithGeneratedMeta = (
  id: string,
  name: string,
  dbFieldName: string,
  persistedAsGeneratedColumn: boolean
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const metaResult = GeneratedColumnMeta.rehydrate({ persistedAsGeneratedColumn });
  if (metaResult.isErr()) return err(metaResult.error);

  const fieldResult = createCreatedTimeField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    meta: metaResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createSelectOptions = (
  choices: ReadonlyArray<{ id: string; name: string; color: string }>
): Result<ReadonlyArray<SelectOption>, DomainError> => {
  const options: SelectOption[] = [];

  for (const choice of choices) {
    const optionResult = SelectOption.create(choice);
    if (optionResult.isErr()) {
      return err(optionResult.error);
    }
    options.push(optionResult.value);
  }

  return ok(options);
};

const createRealSingleSelectField = (params: {
  id: string;
  name: string;
  dbFieldName: string;
  choices: ReadonlyArray<{ id: string; name: string; color: string }>;
}): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(params.id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(params.name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(params.dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const optionsResult = createSelectOptions(params.choices);
  if (optionsResult.isErr()) return err(optionsResult.error);

  const fieldResult = createSingleSelectField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    options: optionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createRealMultipleSelectField = (params: {
  id: string;
  name: string;
  dbFieldName: string;
  choices: ReadonlyArray<{ id: string; name: string; color: string }>;
}): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(params.id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(params.name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(params.dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const optionsResult = createSelectOptions(params.choices);
  if (optionsResult.isErr()) return err(optionsResult.error);

  const fieldResult = createMultipleSelectField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    options: optionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createLookupField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const lookupOptionsResult = LookupOptions.create({
    linkFieldId: createValidFieldId(`link_${id}`),
    lookupFieldId: createValidFieldId(`lookup_${id}`),
    foreignTableId: createValidTableId(`table_${id}`),
  });
  if (lookupOptionsResult.isErr()) return err(lookupOptionsResult.error);

  const fieldResult = createLookupFieldPending({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    lookupOptions: lookupOptionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createSelfLookupField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const sharedDependencyFieldId = createValidFieldId(`dep_${id}`);
  const lookupOptionsResult = LookupOptions.create({
    linkFieldId: sharedDependencyFieldId,
    lookupFieldId: sharedDependencyFieldId,
    foreignTableId: createValidTableId(`table_${id}`),
  });
  if (lookupOptionsResult.isErr()) return err(lookupOptionsResult.error);

  const fieldResult = createLookupFieldPending({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    lookupOptions: lookupOptionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createConditionalLookupField = (
  id: string,
  name: string,
  dbFieldName: string
): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const lookupOptionsResult = ConditionalLookupOptions.create({
    foreignTableId: createValidTableId(`table_${id}`),
    lookupFieldId: createValidFieldId(`lookup_${id}`),
    condition: {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: createValidFieldId(`cond_${id}`),
            operator: 'is',
            value: 'ok',
          },
        ],
      },
    },
  });
  if (lookupOptionsResult.isErr()) return err(lookupOptionsResult.error);

  const fieldResult = createConditionalLookupFieldPending({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    conditionalLookupOptions: lookupOptionsResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const dbFieldResult = DbFieldName.rehydrate(dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

const createRealLinkField = (params: {
  id: string;
  name: string;
  dbFieldName: string;
  relationship: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
  foreignTableId: string;
  fkHostTableName: string;
  selfKeyName: string;
  foreignKeyName: string;
  isOneWay?: boolean;
  hasOrderColumn?: boolean;
  symmetricFieldId?: string;
}): Result<Field, DomainError> => {
  const fieldIdResult = FieldId.create(createValidFieldId(params.id));
  if (fieldIdResult.isErr()) return err(fieldIdResult.error);

  const fieldNameResult = FieldName.create(params.name);
  if (fieldNameResult.isErr()) return err(fieldNameResult.error);

  const dbFieldResult = DbFieldName.rehydrate(params.dbFieldName);
  if (dbFieldResult.isErr()) return err(dbFieldResult.error);

  const configResult = LinkFieldConfig.create({
    relationship: params.relationship,
    foreignTableId: params.foreignTableId,
    lookupFieldId: createValidFieldId(`lookup_${params.id}`),
    fkHostTableName: params.fkHostTableName,
    selfKeyName: params.selfKeyName,
    foreignKeyName: params.foreignKeyName,
    isOneWay: params.isOneWay,
    symmetricFieldId: params.symmetricFieldId,
  });
  if (configResult.isErr()) return err(configResult.error);

  const metaResult = LinkFieldMeta.create({ hasOrderColumn: params.hasOrderColumn ?? false });
  if (metaResult.isErr()) return err(metaResult.error);

  const fieldResult = createLinkField({
    id: fieldIdResult.value,
    name: fieldNameResult.value,
    config: configResult.value,
    meta: metaResult.value,
  });
  if (fieldResult.isErr()) return err(fieldResult.error);

  const setResult = fieldResult.value.setDbFieldName(dbFieldResult.value);
  if (setResult.isErr()) return err(setResult.error);

  return fieldResult;
};

/**
 * Create a mock LinkField for junction table tests.
 */
const createMockLinkField = (
  id: string,
  name: string,
  options: {
    relationship?: 'manyMany' | 'oneMany' | 'manyOne' | 'oneOne';
    isOneWay?: boolean;
    dbFieldName?: string;
  } = {}
): LinkField => {
  return {
    id: () => ({ toString: () => createValidFieldId(id) }),
    name: () => ({ toString: () => name }),
    relationship: () => ({ toString: () => options.relationship ?? 'manyMany' }),
    isOneWay: () => options.isOneWay ?? false,
    dbFieldName: () =>
      ok({
        value: () => ok(options.dbFieldName ?? 'link_value'),
      }),
  } as unknown as LinkField;
};

describe('Schema Rules Unit Tests with PGlite', () => {
  let pglite: PGlite;
  let db: Kysely<V1TeableDatabase>;
  let introspector: SchemaIntrospector;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;

    db = new Kysely<V1TeableDatabase>({
      dialect: new KyselyPGliteDialect(pglite),
    });

    introspector = new PostgresSchemaIntrospector(db);

    // Create test schema
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(TEST_SCHEMA)}`.execute(db);

    // Create field and reference tables for FieldMetaRule and ReferenceRule tests
    await sql`CREATE TABLE IF NOT EXISTS field (
      id TEXT PRIMARY KEY,
      name TEXT,
      description TEXT,
      type TEXT,
      options TEXT,
      table_id TEXT,
      tableId TEXT,
      db_field_name TEXT,
      deleted_time TIMESTAMPTZ,
      meta TEXT
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS table_meta (
      id TEXT PRIMARY KEY,
      db_table_name TEXT,
      deleted_time TIMESTAMPTZ
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS reference (
      id TEXT PRIMARY KEY,
      to_field_id TEXT NOT NULL,
      from_field_id TEXT NOT NULL,
      UNIQUE(to_field_id, from_field_id)
    )`.execute(db);
  });

  afterAll(async () => {
    await sql`DROP SCHEMA IF EXISTS ${sql.id(TEST_SCHEMA)} CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS field CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS table_meta CASCADE`.execute(db);
    await sql`DROP TABLE IF EXISTS reference CASCADE`.execute(db);
    await db.destroy();
  });

  afterEach(async () => {
    // Drop all tables in test schema after each test
    const result = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${TEST_SCHEMA}
    `.execute(db);

    for (const row of result.rows) {
      await sql`DROP TABLE IF EXISTS ${sql.id(TEST_SCHEMA)}.${sql.id(row.table_name)} CASCADE`.execute(
        db
      );
    }

    await sql`DELETE FROM table_meta`.execute(db);
  });

  const createTestTable = async (tableName: string, columns: string[] = []) => {
    let query = `CREATE TABLE ${TEST_SCHEMA}.${tableName} (__id TEXT PRIMARY KEY`;
    for (const col of columns) {
      query += `, ${col}`;
    }
    query += ')';
    await sql.raw(query).execute(db);
  };

  const createExplicitTestTable = async (tableName: string, columns: string[]) => {
    const query = `CREATE TABLE ${TEST_SCHEMA}.${tableName} (${columns.join(', ')})`;
    await sql.raw(query).execute(db);
  };

  const createContext = (tableName: string, field: Field): SchemaRuleContext => ({
    db,
    introspector,
    schema: TEST_SCHEMA,
    tableName,
    tableId: tableName,
    field,
  });

  const createTableAggregate = (tableName: string, field: Field): Table => {
    const tableIdResult = TableId.create(createValidTableId(`table_${tableName}`));
    if (tableIdResult.isErr()) {
      throw new Error(tableIdResult.error.message);
    }

    const baseIdResult = BaseId.create(`base_${tableName}`);
    if (baseIdResult.isErr()) {
      throw new Error(baseIdResult.error.message);
    }

    const tableNameResult = TableName.create(tableName);
    if (tableNameResult.isErr()) {
      throw new Error(tableNameResult.error.message);
    }

    const dbTableNameResult = DbTableName.rehydrate(`${TEST_SCHEMA}.${tableName}`);
    if (dbTableNameResult.isErr()) {
      throw new Error(dbTableNameResult.error.message);
    }

    const tableResult = Table.rehydrate({
      id: tableIdResult.value,
      baseId: baseIdResult.value,
      name: tableNameResult.value,
      fields: [field],
      views: [],
      primaryFieldId: field.id(),
      dbTableName: dbTableNameResult.value,
    });

    if (tableResult.isErr()) {
      throw new Error(tableResult.error.message);
    }

    return tableResult.value;
  };

  const createTableAggregateWithId = (
    tableId: string,
    tableName: string,
    fields: ReadonlyArray<Field>,
    primaryFieldId = fields[0]?.id()
  ): Table => {
    const tableIdResult = TableId.create(tableId);
    if (tableIdResult.isErr()) {
      throw new Error(tableIdResult.error.message);
    }

    const baseIdSeed = sanitizeIdSeed(tableName).padEnd(16, '0').slice(0, 16);
    const baseIdResult = BaseId.create(`bse${baseIdSeed}`);
    if (baseIdResult.isErr()) {
      throw new Error(baseIdResult.error.message);
    }

    const tableNameResult = TableName.create(tableName);
    if (tableNameResult.isErr()) {
      throw new Error(tableNameResult.error.message);
    }

    const dbTableNameResult = DbTableName.rehydrate(`${TEST_SCHEMA}.${tableName}`);
    if (dbTableNameResult.isErr()) {
      throw new Error(dbTableNameResult.error.message);
    }

    if (!primaryFieldId) {
      throw new Error('primaryFieldId is required');
    }

    const tableResult = Table.rehydrate({
      id: tableIdResult.value,
      baseId: baseIdResult.value,
      name: tableNameResult.value,
      fields,
      views: [],
      primaryFieldId,
      dbTableName: dbTableNameResult.value,
    });

    if (tableResult.isErr()) {
      throw new Error(tableResult.error.message);
    }

    return tableResult.value;
  };

  const createComputedBackfillService = (foreignTables: ReadonlyArray<Table>) =>
    new ComputedFieldBackfillService(
      {
        find: async () => ok(foreignTables),
        findOne: async () => ok(foreignTables[0]),
      } as never,
      {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      } as never,
      { hash: () => 'hash' } as never,
      db,
      { enqueueFieldBackfill: async () => ok({ taskId: 'task' }) } as never,
      { mode: 'sync', hybridThreshold: 5000 },
      new Pg16TypeValidationStrategy()
    );

  const collectFinalResults = async (
    generator: AsyncGenerator<SchemaCheckResult, void, unknown>
  ): Promise<SchemaCheckResult[]> => {
    const results: SchemaCheckResult[] = [];
    for await (const result of generator) {
      if (result.status === 'running' || result.status === 'pending') {
        continue;
      }
      results.push(result);
    }
    return results;
  };

  const collectFinalRepairResults = async (
    generator: AsyncGenerator<SchemaRepairResult, void, unknown>
  ): Promise<SchemaRepairResult[]> => {
    const results: SchemaRepairResult[] = [];
    for await (const result of generator) {
      if (result.status === 'running' || result.status === 'pending') {
        continue;
      }
      results.push(result);
    }
    return results;
  };

  const constraintExists = async (tableName: string, constraintName: string): Promise<boolean> => {
    const result = await sql<{ cnt: string }>`
      SELECT count(*)::text AS cnt
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = ${TEST_SCHEMA}
        AND t.relname = ${tableName}
        AND c.conname = ${constraintName}
    `.execute(db);
    return result.rows[0]?.cnt === '1';
  };

  describe('ColumnExistsRule', () => {
    const TABLE_NAME = 'test_column_rule';

    it('should return invalid when column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('col001', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.length).toBeGreaterThan(0);
    });

    it('should create column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('col002', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      // Before up: should be invalid
      const beforeResult = await rule.isValid(ctx);
      expect(beforeResult._unsafeUnwrap().valid).toBe(false);

      // Execute up
      const upResult = rule.up(ctx);
      expect(upResult.isOk()).toBe(true);
      for (const stmt of upResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // After up: should be valid
      const afterResult = await rule.isValid(ctx);
      expect(afterResult._unsafeUnwrap().valid).toBe(true);
    });

    it('should drop column with down() and validate it no longer exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('col003', 'Name', 'name_col');
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      // Before down: should be valid
      const beforeResult = await rule.isValid(ctx);
      expect(beforeResult._unsafeUnwrap().valid).toBe(true);

      // Execute down
      const downResult = rule.down(ctx);
      expect(downResult.isOk()).toBe(true);
      for (const stmt of downResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // After down: should be invalid
      const afterResult = await rule.isValid(ctx);
      expect(afterResult._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('col004', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();
      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      // Initial state: invalid
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      // up
      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      // down
      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it.each([
      {
        label: 'lookup',
        factory: () => createLookupField('lookup001', 'ParentName', 'parent_name'),
      },
      {
        label: 'conditionalLookup',
        factory: () =>
          createConditionalLookupField('clookup001', 'FilteredParentName', 'parent_name'),
      },
    ])('creates $label column as jsonb', async ({ factory }) => {
      await createTestTable(TABLE_NAME);

      const fieldResult = factory();
      if (fieldResult.isErr()) {
        throw new Error(`Failed to create field: ${fieldResult.error.message}`);
      }
      const field = fieldResult._unsafeUnwrap();

      const rule = new ColumnExistsRule(field);
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const columnResult = await introspector.getColumn(TEST_SCHEMA, TABLE_NAME, 'parent_name');
      expect(columnResult.isOk()).toBe(true);
      expect(columnResult._unsafeUnwrap()?.dataType).toBe('jsonb');
    });
  });

  describe('ColumnUniqueConstraintRule', () => {
    const TABLE_NAME = 'test_unique_constraint_rule';

    it('should return invalid when unique index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq001', 'Email', 'email_col', { unique: true });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create unique index with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq002', 'Email', 'email_col', { unique: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      // Before up: should be invalid
      const beforeResult = await rule.isValid(ctx);
      expect(beforeResult._unsafeUnwrap().valid).toBe(false);

      // Execute up
      const upResult = rule.up(ctx);
      expect(upResult.isOk()).toBe(true);
      for (const stmt of upResult._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      // After up: should be valid
      const afterResult = await rule.isValid(ctx);
      expect(afterResult._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq003', 'Email', 'email_col', { unique: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('down should remove a constraint-backed unique created by constraint updates', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uniq004', 'Email', 'email_col', { unique: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new ColumnUniqueConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      await db.executeQuery(
        sql`ALTER TABLE ${sql.ref(TEST_SCHEMA)}.${sql.ref(TABLE_NAME)} ADD CONSTRAINT ${sql.ref(
          `${TABLE_NAME}_email_col_unique`
        )} UNIQUE (${sql.ref('email_col')})`.compile(db)
      );

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('NotNullConstraintRule', () => {
    const TABLE_NAME = 'test_not_null_rule';

    it('should detect missing NOT NULL constraint', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('nn001', 'Name', 'name_col', { notNull: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('NOT NULL'))).toBe(true);
    });

    it('should return valid when NOT NULL constraint exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT NOT NULL']);

      const fieldResult = createRealField('nn002', 'Name', 'name_col', { notNull: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ["name_col TEXT DEFAULT ''"]);

      const fieldResult = createRealField('nn003', 'Name', 'name_col', { notNull: true });
      const field = fieldResult._unsafeUnwrap();

      const columnRule = new ColumnExistsRule(field);
      const rule = new NotNullConstraintRule(field, columnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should backfill FK values from the persisted link JSON column', async () => {
      await createTestTable(TABLE_NAME, ['link_value JSONB']);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${TABLE_NAME} (__id, link_value)
          VALUES
            ('rec_alpha', '{"id":"rec_target_a","title":"Target A"}'::jsonb),
            ('rec_beta', '{"id":"rec_target_b","title":"Target B"}'::jsonb),
            ('rec_empty', NULL)
        `
        )
        .execute(db);

      const fieldResult = createRealField('fkc004', 'Link', 'link_value');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, '__fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const rows = await sql<{ record_id: string; fk: string | null }>`
        SELECT __id AS record_id, "__fk_link" AS fk
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(TABLE_NAME)}
        ORDER BY __id
      `.execute(db);

      expect(rows.rows).toEqual([
        { record_id: 'rec_alpha', fk: 'rec_target_a' },
        { record_id: 'rec_beta', fk: 'rec_target_b' },
        { record_id: 'rec_empty', fk: null },
      ]);
    });
  });

  describe('FkColumnRule', () => {
    const TABLE_NAME = 'test_fk_column_rule';

    it('should return invalid when FK column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fkc001', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create FK column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fkc002', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fkc003', 'Link', 'fk_link');
      const field = fieldResult._unsafeUnwrap();

      const rule = FkColumnRule.forField(field, 'fk_link', 'target_table');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('IndexRule', () => {
    const TABLE_NAME = 'test_index_rule';

    it('should return invalid when index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('idx001', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create index with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('idx002', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('should return invalid when an existing FK index is unique', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);
      await sql
        .raw(
          `ALTER TABLE ${TEST_SCHEMA}.${TABLE_NAME}
           ADD CONSTRAINT index_name_col UNIQUE (name_col)`
        )
        .execute(db);

      const fieldResult = createRealField('idx004', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toMatchObject({
        valid: false,
        missing: ['non-unique index index_name_col'],
        extra: ['unique constraint or index index_name_col'],
      });
    });

    it('should replace a stale unique FK constraint with a non-unique index', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);
      await sql
        .raw(
          `ALTER TABLE ${TEST_SCHEMA}.${TABLE_NAME}
           ADD CONSTRAINT index_name_col UNIQUE (name_col)`
        )
        .execute(db);

      const fieldResult = createRealField('idx005', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
      await expect(constraintExists(TABLE_NAME, 'index_name_col')).resolves.toBe(true);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const index = (await introspector.getIndex(TEST_SCHEMA, 'index_name_col'))._unsafeUnwrap();
      expect(index).toMatchObject({ isUnique: false, columnNames: ['name_col'] });
      await expect(constraintExists(TABLE_NAME, 'index_name_col')).resolves.toBe(false);
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('idx003', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'name_col', 'other_table');
      const rule = IndexRule.forFkColumn(field, 'name_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('UniqueIndexRule', () => {
    const TABLE_NAME = 'test_unique_index_rule';

    it('should return invalid when unique index does not exist', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uidx001', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should return invalid when index exists but is not unique', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);
      await sql
        .raw(`CREATE INDEX index_email_col ON ${TEST_SCHEMA}.${TABLE_NAME}(email_col)`)
        .execute(db);

      const fieldResult = createRealField('uidx002', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('not unique'))).toBe(true);
    });

    it('should create unique index with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uidx003', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['email_col TEXT']);

      const fieldResult = createRealField('uidx004', 'Email', 'email_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'email_col', 'other_table');
      const rule = UniqueIndexRule.forFkColumn(field, 'email_col', fkColumnRule);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('ForeignKeyRule', () => {
    const SOURCE_TABLE = 'test_fk_source';
    const TARGET_TABLE = 'test_fk_target';

    it('should return invalid when FK constraint does not exist', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk001', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create FK constraint with up() and validate it exists', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk002', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('should resolve the FK target table from table_meta dbTableName', async () => {
      const targetTableMetaId = createValidTableId('logical_target');
      const targetPhysicalTableName = 'students_custom';

      await createTestTable(targetPhysicalTableName);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);
      await sql`
        INSERT INTO table_meta (id, db_table_name, deleted_time)
        VALUES (${targetTableMetaId}, ${`${TEST_SCHEMA}.${targetPhysicalTableName}`}, NULL)
      `.execute(db);

      const fieldResult = createRealField('fkmeta01', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', targetTableMetaId);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: targetTableMetaId },
        fkColumnRule,
        'Students',
        'CASCADE',
        undefined,
        targetTableMetaId
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TARGET_TABLE);
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk003', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should mark repair as unavailable when the target table is missing', async () => {
      await createTestTable(SOURCE_TABLE, ['fk_col TEXT']);

      const fieldResult = createRealField('fk004', 'Link', 'fk_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'fk_col', TARGET_TABLE);
      const rule = ForeignKeyRule.forField(
        field,
        'fk_col',
        { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        fkColumnRule,
        TARGET_TABLE
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const validation = await rule.isValid(ctx);
      expect(validation.isOk()).toBe(true);
      expect(
        validation
          ._unsafeUnwrap()
          .missingItems?.some((item) => item.code === 'foreign_key_target_table_missing')
      ).toBe(true);

      const repairHint = rule.getRepairHint(ctx, validation._unsafeUnwrap());
      expect(repairHint.isOk()).toBe(true);
      expect(repairHint._unsafeUnwrap()).toEqual({
        available: false,
        mode: 'auto',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.foreignKeyTargetTableMissing',
          values: {
            fieldName: 'Link',
            targetTableName: TARGET_TABLE,
          },
          fallback:
            'Automatic repair is unavailable because the linked table for "Link" is missing.',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.foreignKeyTargetTableMissing',
          values: {
            fieldName: 'Link',
            targetTableName: TARGET_TABLE,
            targetPhysicalTableName: TARGET_TABLE,
          },
          fallback: `Check whether the linked table "${TARGET_TABLE}" was deleted or renamed. Recreate the table, or update/remove the link field configuration for "Link", then run the check again.`,
        },
      });
    });
  });

  describe('OrderColumnRule', () => {
    const TABLE_NAME = 'test_order_column_rule';

    it('should return invalid when order column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ord001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld001',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create order column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ord002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld002',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ord003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const fkColumnRule = FkColumnRule.forField(field, 'link_col', 'target_table');
      const rule = OrderColumnRule.forField(
        field,
        'order_fld003',
        { schema: TEST_SCHEMA, tableName: TABLE_NAME },
        fkColumnRule
      );
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('LinkValueColumnRule', () => {
    const TABLE_NAME = 'test_link_value_column_rule';

    it('should return invalid when link value column does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('lvc001', 'Link', 'link_value_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = LinkValueColumnRule.forField(field, 'oneWay');
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create link value column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('lvc002', 'Link', 'link_value_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = LinkValueColumnRule.forField(field, 'oneWay');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('lvc003', 'Link', 'link_value_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = LinkValueColumnRule.forField(field, 'oneWay');
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('GeneratedColumnRule', () => {
    const TABLE_NAME = 'test_generated_column_rule';

    it('should return invalid when generated column does not exist', async () => {
      await createTestTable(TABLE_NAME, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

      const fieldResult = createRealField('gen001', 'CreatedTime', 'created_time_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = GeneratedColumnRule.forCreatedTime(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('should create generated column with up() and validate it exists', async () => {
      await createTestTable(TABLE_NAME, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

      const fieldResult = createRealField('gen002', 'CreatedTime', 'created_time_col');
      const field = fieldResult._unsafeUnwrap();

      // Insert a field record for the GeneratedColumnRule (it updates field meta)
      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'CreatedTime', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = GeneratedColumnRule.forCreatedTime(field);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

      const fieldResult = createRealField('gen003', 'CreatedTime', 'created_time_col');
      const field = fieldResult._unsafeUnwrap();

      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'CreatedTime', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = GeneratedColumnRule.forCreatedTime(field);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('GeneratedColumnMetaRule', () => {
    const TABLE_NAME = 'test_generated_column_meta_rule';

    it('should return invalid when field meta expects a stored column but db column is generated', async () => {
      await createTestTable(TABLE_NAME, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'genm001',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();

      const generatedRule = GeneratedColumnRule.forCreatedTime(field);
      const rule = new GeneratedColumnMetaRule(field, generatedRule, new ColumnExistsRule(field));
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().extra?.[0]).toContain('persistedAsGeneratedColumn is false');
    });

    it('up then down should switch between stored and generated column states', async () => {
      await createTestTable(TABLE_NAME, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'genm002',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();

      const generatedRule = GeneratedColumnRule.forCreatedTime(field);
      const rule = new GeneratedColumnMetaRule(field, generatedRule, new ColumnExistsRule(field));
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      const storedColumnResult = await introspector.getColumn(
        TEST_SCHEMA,
        TABLE_NAME,
        'created_time_col'
      );
      expect(storedColumnResult._unsafeUnwrap()?.isGenerated).toBe(false);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
      expect((await generatedRule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });
  });

  describe('JunctionTableExistsRule', () => {
    const SOURCE_TABLE = 'test_junction_source';
    const TARGET_TABLE = 'test_junction_target';
    const JUNCTION_TABLE = 'junction_test';

    const createJunctionConfig = (): JunctionTableConfig => ({
      junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
      selfKeyName: 'self_key',
      foreignKeyName: 'foreign_key',
      orderColumnName: 'order_col',
      sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
      foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
      withIndexes: true,
    });

    it('should return invalid when junction table does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('jct001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct001', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('junction table'))).toBe(true);
    });

    it('should create junction table with up() and validate it exists', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('jct002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct002', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);

      const fieldResult = createRealField('jct003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct003', 'Link');
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

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
      } as unknown as JunctionTableConfig;

      const rule = new JunctionTableExistsRule(linkField, config);
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('should backfill junction rows from the persisted link JSON column', async () => {
      await createTestTable(SOURCE_TABLE, ['link_value JSONB']);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${SOURCE_TABLE} (__id, link_value)
          VALUES
            (
              'rec_source_1',
              '[{"id":"rec_foreign_1","title":"Foreign 1"},{"id":"rec_foreign_2","title":"Foreign 2"}]'::jsonb
            ),
            (
              'rec_source_2',
              '[{"id":"rec_foreign_3","title":"Foreign 3"}]'::jsonb
            )
        `
        )
        .execute(db);

      const fieldResult = createRealField('jct005', 'Link', 'link_value');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jct005', 'Link', { dbFieldName: 'link_value' });
      const rule = new JunctionTableExistsRule(linkField, createJunctionConfig());
      const ctx = createContext(SOURCE_TABLE, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const rows = await sql<{
        self_key: string;
        foreign_key: string;
        order_col: number;
      }>`
        SELECT self_key, foreign_key, order_col
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(JUNCTION_TABLE)}
        ORDER BY self_key, order_col
      `.execute(db);

      expect(rows.rows).toEqual([
        { self_key: 'rec_source_1', foreign_key: 'rec_foreign_1', order_col: 1 },
        { self_key: 'rec_source_1', foreign_key: 'rec_foreign_2', order_col: 2 },
        { self_key: 'rec_source_2', foreign_key: 'rec_foreign_3', order_col: 1 },
      ]);
    });
  });

  describe('JunctionTableUniqueConstraintRule', () => {
    const SOURCE_TABLE = 'test_jct_unique_source';
    const TARGET_TABLE = 'test_jct_unique_target';
    const JUNCTION_TABLE = 'junction_unique_test';

    it('should return invalid when unique constraint does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctu001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctu001', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableUniqueConstraintRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'foreign_key',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctu002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctu002', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableUniqueConstraintRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'foreign_key',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('JunctionTableIndexRule', () => {
    const SOURCE_TABLE = 'test_jct_index_source';
    const TARGET_TABLE = 'test_jct_index_target';
    const JUNCTION_TABLE = 'junction_index_test';

    it('should return invalid when index does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jcti001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jcti001', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: true,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableIndexRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jcti002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jcti002', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: true,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableIndexRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });
  });

  describe('JunctionTableForeignKeyRule', () => {
    const SOURCE_TABLE = 'test_jct_fk_source';
    const TARGET_TABLE = 'test_jct_fk_target';
    const JUNCTION_TABLE = 'junction_fk_test';
    const FOREIGN_TABLE_META_ID = 'tbljctfkmeta000001';

    it('should return invalid when FK does not exist', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctfk001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctfk001', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableForeignKeyRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(SOURCE_TABLE);
      await createTestTable(TARGET_TABLE);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      const fieldResult = createRealField('jctfk002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const linkField = createMockLinkField('jctfk002', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: TARGET_TABLE },
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableForeignKeyRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'self_key',
        { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        'self',
        junctionRule
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should resolve the junction FK target table from table_meta dbTableName', async () => {
      const logicalTargetTableName = FOREIGN_TABLE_META_ID;
      const physicalTargetTableName = 'test_jct_fk_target_legacy';

      await createTestTable(SOURCE_TABLE);
      await createTestTable(physicalTargetTableName);
      await sql
        .raw(
          `CREATE TABLE ${TEST_SCHEMA}.${JUNCTION_TABLE} (
          __id SERIAL PRIMARY KEY,
          self_key TEXT,
          foreign_key TEXT,
          order_col DOUBLE PRECISION
        )`
        )
        .execute(db);

      await sql`
        INSERT INTO table_meta (id, db_table_name, deleted_time)
        VALUES (${FOREIGN_TABLE_META_ID}, ${`${TEST_SCHEMA}.${physicalTargetTableName}`}, NULL)
      `.execute(db);

      const fieldResult = createRealField('jctfk003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();
      const linkField = createMockLinkField('jctfk003', 'Link');
      const config: JunctionTableConfig = {
        junctionTable: { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        selfKeyName: 'self_key',
        foreignKeyName: 'foreign_key',
        orderColumnName: 'order_col',
        sourceTable: { schema: TEST_SCHEMA, tableName: SOURCE_TABLE },
        foreignTable: { schema: TEST_SCHEMA, tableName: logicalTargetTableName },
        foreignTableMetaId: FOREIGN_TABLE_META_ID,
        withIndexes: false,
      };
      const junctionRule = new JunctionTableExistsRule(linkField, config);
      const rule = new JunctionTableForeignKeyRule(
        linkField,
        { schema: TEST_SCHEMA, tableName: JUNCTION_TABLE },
        'foreign_key',
        { schema: TEST_SCHEMA, tableName: logicalTargetTableName },
        'foreign',
        junctionRule,
        FOREIGN_TABLE_META_ID
      );
      const ctx = createContext(SOURCE_TABLE, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);
    });
  });

  describe('FieldMetaRule', () => {
    const TABLE_NAME = 'test_field_meta_rule';

    it('should return invalid when field record does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr001', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('not found'))).toBe(true);
    });

    it('should return invalid when meta is missing expected keys', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr002', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      // Insert field record with empty meta
      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Link', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('hasOrderColumn'))).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr003', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      // Insert field record with empty meta
      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Link', '{}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      // After down, meta is set to {} which doesn't have hasOrderColumn
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should merge metadata updates instead of overwriting unrelated keys', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr004', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Link', '{"foo":"bar","nested":{"keep":true}}') ON CONFLICT (id) DO NOTHING`.execute(
        db
      );

      const rule = FieldMetaRule.forOrderColumn(field);
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const row = await db
        .selectFrom('field')
        .select('meta')
        .where('id', '=', field.id().toString())
        .executeTakeFirstOrThrow();
      const meta =
        typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta as Record<string, unknown>);

      expect(meta).toMatchObject({
        foo: 'bar',
        nested: { keep: true },
        hasOrderColumn: true,
      });

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const revertedRow = await db
        .selectFrom('field')
        .select('meta')
        .where('id', '=', field.id().toString())
        .executeTakeFirstOrThrow();
      const revertedMeta =
        typeof revertedRow.meta === 'string'
          ? JSON.parse(revertedRow.meta)
          : (revertedRow.meta as Record<string, unknown>);

      expect(revertedMeta).toMatchObject({
        foo: 'bar',
        nested: { keep: true },
      });
      expect(revertedMeta).not.toHaveProperty('hasOrderColumn');
    });

    it('should repair text-backed field meta columns', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('fmr005', 'Link', 'link_col');
      const field = fieldResult._unsafeUnwrap();

      try {
        await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Link', ${JSON.stringify({ foo: 'bar' })})`.execute(
          db
        );

        const rule = FieldMetaRule.forOrderColumn(field);
        const ctx = createContext(TABLE_NAME, field);

        for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
          await db.executeQuery(stmt.compile(db));
        }

        const row = await db
          .selectFrom('field')
          .select('meta')
          .where('id', '=', field.id().toString())
          .executeTakeFirstOrThrow();

        expect(typeof row.meta).toBe('string');
        expect(JSON.parse(row.meta as string)).toMatchObject({
          foo: 'bar',
          hasOrderColumn: true,
        });
      } finally {
        await sql`DELETE FROM field WHERE id = ${field.id().toString()}`.execute(db);
      }
    });
  });

  describe('SelectOptionsMetaRule', () => {
    const TABLE_NAME = 'test_select_options_rule';
    const expectedChoices = [
      { id: 'choKeep', name: 'Keep', color: 'blueBright' },
      { id: 'choDone', name: 'Done', color: 'greenBright' },
    ] as const;

    it('should validate and repair select option choices without rewriting stored record values', async () => {
      await createTestTable(TABLE_NAME, ['status_col TEXT']);

      const fieldResult = createRealSingleSelectField({
        id: 'som001',
        name: 'Status',
        dbFieldName: 'status_col',
        choices: expectedChoices,
      });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      await sql
        .raw(
          `INSERT INTO ${TEST_SCHEMA}.${TABLE_NAME} (__id, status_col) VALUES ('rec_status_1', 'choKeep')`
        )
        .execute(db);
      await sql`INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${field.id().toString()},
          'Status',
          'singleSelect',
          ${JSON.stringify({
            choices: [
              { id: 'choDup', name: 'Legacy', color: 'redBright' },
              { id: 'choDup', name: 'Legacy Duplicate', color: 'yellowBright' },
            ],
            defaultValue: 'choKeep',
            preventAutoNewOptions: true,
          })},
          ${TABLE_NAME}
        )`.execute(db);

      const rule = new SelectOptionsMetaRule(field);
      const ctx = createContext(TABLE_NAME, field);

      const invalidResult = await rule.isValid(ctx);
      expect(invalidResult.isOk()).toBe(true);
      expect(invalidResult._unsafeUnwrap().valid).toBe(false);
      expect(invalidResult._unsafeUnwrap().missing).toContain(
        'options.choices does not match the field definition'
      );

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      const fieldRow = await db
        .selectFrom('field')
        .select('options')
        .where('id', '=', field.id().toString())
        .executeTakeFirstOrThrow();
      const options =
        typeof fieldRow.options === 'string'
          ? JSON.parse(fieldRow.options)
          : (fieldRow.options as Record<string, unknown>);

      expect(options).toMatchObject({
        choices: expectedChoices,
        defaultValue: 'choKeep',
        preventAutoNewOptions: true,
      });

      const recordRow = await sql<{ status_col: string }>`
        SELECT status_col
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(TABLE_NAME)}
        WHERE __id = 'rec_status_1'
      `.execute(db);
      expect(recordRow.rows[0]?.status_col).toBe('choKeep');
    });

    it('should remap single-select values that point to removed duplicate choices', async () => {
      await createTestTable(TABLE_NAME, ['status_col TEXT']);

      const fieldResult = createRealSingleSelectField({
        id: 'som006',
        name: 'Status Duplicate Choices',
        dbFieldName: 'status_col',
        choices: [
          { id: 'choDup', name: 'Legacy', color: 'blueBright' },
          { id: 'choDup', name: 'Legacy Duplicate', color: 'yellowBright' },
          { id: 'choKeep', name: 'Keep', color: 'greenBright' },
        ],
      });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      await sql
        .raw(
          `INSERT INTO ${TEST_SCHEMA}.${TABLE_NAME} (__id, status_col) VALUES
            ('rec_duplicate_name', 'Legacy Duplicate'),
            ('rec_canonical_name', 'Legacy'),
            ('rec_keep', 'Keep')`
        )
        .execute(db);
      await sql`INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${field.id().toString()},
          'Status Duplicate Choices',
          'singleSelect',
          ${JSON.stringify({
            choices: [
              { id: 'choDup', name: 'Legacy', color: 'blueBright' },
              { id: 'choDup', name: 'Legacy Duplicate', color: 'yellowBright' },
              { id: 'choKeep', name: 'Keep', color: 'greenBright' },
            ],
          })},
          ${TABLE_NAME}
        )`.execute(db);

      const rule = new SelectOptionsMetaRule(field);
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const rows = await sql<{ __id: string; status_col: string }>`
        SELECT __id, status_col
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(TABLE_NAME)}
        ORDER BY __id
      `.execute(db);
      expect(rows.rows).toEqual([
        { __id: 'rec_canonical_name', status_col: 'Legacy' },
        { __id: 'rec_duplicate_name', status_col: 'Legacy' },
        { __id: 'rec_keep', status_col: 'Keep' },
      ]);

      const fieldRow = await db
        .selectFrom('field')
        .select('options')
        .where('id', '=', field.id().toString())
        .executeTakeFirstOrThrow();
      const options = JSON.parse(fieldRow.options as string) as {
        choices: ReadonlyArray<{ id: string; name: string; color: string }>;
      };
      expect(options.choices).toEqual([
        { id: 'choDup', name: 'Legacy', color: 'blueBright' },
        { id: 'choKeep', name: 'Keep', color: 'greenBright' },
      ]);
    });

    it('should remap and dedupe multiple-select values that point to removed duplicate choices', async () => {
      await createTestTable(TABLE_NAME, ['tags_col JSONB']);

      const fieldResult = createRealMultipleSelectField({
        id: 'som007',
        name: 'Tags Duplicate Choices',
        dbFieldName: 'tags_col',
        choices: [
          { id: 'choDup', name: 'Legacy', color: 'blueBright' },
          { id: 'choDup', name: 'Legacy Duplicate', color: 'yellowBright' },
          { id: 'choKeep', name: 'Keep', color: 'greenBright' },
        ],
      });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      await sql
        .raw(
          `INSERT INTO ${TEST_SCHEMA}.${TABLE_NAME} (__id, tags_col) VALUES
            ('rec_tags', '["Legacy Duplicate","Legacy","Keep"]'::jsonb)`
        )
        .execute(db);
      await sql`INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${field.id().toString()},
          'Tags Duplicate Choices',
          'multipleSelect',
          ${JSON.stringify({
            choices: [
              { id: 'choDup', name: 'Legacy', color: 'blueBright' },
              { id: 'choDup', name: 'Legacy Duplicate', color: 'yellowBright' },
              { id: 'choKeep', name: 'Keep', color: 'greenBright' },
            ],
          })},
          ${TABLE_NAME}
        )`.execute(db);

      const rule = new SelectOptionsMetaRule(field);
      const ctx = createContext(TABLE_NAME, field);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }

      const recordRow = await sql<{ tags_col: unknown }>`
        SELECT tags_col
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(TABLE_NAME)}
        WHERE __id = 'rec_tags'
      `.execute(db);
      expect(recordRow.rows[0]?.tags_col).toEqual(['Legacy', 'Keep']);
    });

    it('should repair text-backed field options columns', async () => {
      await createTestTable(TABLE_NAME, ['status_col TEXT']);

      const fieldResult = createRealSingleSelectField({
        id: 'som005',
        name: 'Status Text Options',
        dbFieldName: 'status_col',
        choices: expectedChoices,
      });
      expect(fieldResult.isOk()).toBe(true);
      const field = fieldResult._unsafeUnwrap();

      try {
        await sql`INSERT INTO field (id, name, type, options, table_id)
          VALUES (
            ${field.id().toString()},
            'Status Text Options',
            'singleSelect',
            ${JSON.stringify({
              choices: [{ id: 'choLegacy', name: 'Legacy', color: 'redBright' }],
              defaultValue: 'choKeep',
            })},
            ${TABLE_NAME}
          )`.execute(db);

        const rule = new SelectOptionsMetaRule(field);
        const ctx = createContext(TABLE_NAME, field);

        for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
          await db.executeQuery(stmt.compile(db));
        }

        const row = await db
          .selectFrom('field')
          .select('options')
          .where('id', '=', field.id().toString())
          .executeTakeFirstOrThrow();

        expect(typeof row.options).toBe('string');
        expect(JSON.parse(row.options as string)).toMatchObject({
          choices: expectedChoices,
          defaultValue: 'choKeep',
        });
      } finally {
        await sql`DELETE FROM field WHERE id = ${field.id().toString()}`.execute(db);
      }
    });

    it('should surface display impact in the repair hint', () => {
      const field = createRealSingleSelectField({
        id: 'som002',
        name: 'Status',
        dbFieldName: 'status_col',
        choices: expectedChoices,
      })._unsafeUnwrap();
      const rule = new SelectOptionsMetaRule(field);

      const repairHint = rule.getRepairHint({} as SchemaRuleContext, { valid: false });

      expect(repairHint.isOk()).toBe(true);
      expect(repairHint._unsafeUnwrap()).toMatchObject({
        available: true,
        mode: 'auto',
        description: {
          fallback: expect.stringContaining(
            'migrates cells that point at removed duplicate choice'
          ),
        },
      });
      expect(repairHint._unsafeUnwrap()?.description?.fallback).toContain('display');
    });

    it('should register the select options rule for both single and multiple select fields', () => {
      const singleField = createRealSingleSelectField({
        id: 'som003',
        name: 'Single Status',
        dbFieldName: 'single_status_col',
        choices: expectedChoices,
      })._unsafeUnwrap();
      const multipleField = createRealMultipleSelectField({
        id: 'som004',
        name: 'Multiple Status',
        dbFieldName: 'multiple_status_col',
        choices: expectedChoices,
      })._unsafeUnwrap();

      const singleRules = createFieldSchemaRules(singleField, {
        schema: TEST_SCHEMA,
        tableName: TABLE_NAME,
        tableId: TABLE_NAME,
      })._unsafeUnwrap();
      const multipleRules = createFieldSchemaRules(multipleField, {
        schema: TEST_SCHEMA,
        tableName: TABLE_NAME,
        tableId: TABLE_NAME,
      })._unsafeUnwrap();

      expect(
        singleRules.some((rule) => rule.id === `select_options:${singleField.id().toString()}`)
      ).toBe(true);
      expect(
        multipleRules.some((rule) => rule.id === `select_options:${multipleField.id().toString()}`)
      ).toBe(true);
    });
  });

  describe('ReferenceRule', () => {
    const TABLE_NAME = 'test_reference_rule';

    it('should return valid when no references expected', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref001', 'Text', 'text_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = new ReferenceRule(field, []);
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('should return invalid when reference entry does not exist', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref002', 'Formula', 'formula_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = ReferenceRule.single(field, 'fld_source_field_001', { fieldType: 'formula' });
      const ctx = createContext(TABLE_NAME, field);

      const result = await rule.isValid(ctx);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missing?.some((m) => m.includes('reference entry'))).toBe(true);
    });

    it('up then down should return to original state', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref003', 'Formula', 'formula_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = ReferenceRule.single(field, 'fld_source_field_001', { fieldType: 'formula' });
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should handle multiple references', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('ref004', 'Rollup', 'rollup_col');
      const field = fieldResult._unsafeUnwrap();

      const rule = ReferenceRule.multiple(field, ['fld_link_field_001', 'fld_value_field_001'], {
        fieldType: 'rollup',
      });
      const ctx = createContext(TABLE_NAME, field);

      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);

      for (const stmt of rule.up(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(true);

      for (const stmt of rule.down(ctx)._unsafeUnwrap()) {
        await db.executeQuery(stmt.compile(db));
      }
      expect((await rule.isValid(ctx))._unsafeUnwrap().valid).toBe(false);
    });

    it('should deduplicate self-lookup reference rules when link and lookup ids match', () => {
      const field = createSelfLookupField(
        'self_lookup001',
        'SelfLookup',
        'self_lookup_col'
      )._unsafeUnwrap();
      const rulesResult = createFieldSchemaRules(field, {
        schema: TEST_SCHEMA,
        tableName: 'self_lookup_table',
        tableId: 'self_lookup_table',
      });

      expect(rulesResult.isOk()).toBe(true);

      const referenceRules = rulesResult
        ._unsafeUnwrap()
        .filter((rule) => rule instanceof ReferenceRule);
      expect(referenceRules).toHaveLength(1);
      expect(referenceRules[0].id).toBe(
        `reference:${field.id().toString()}:${createValidFieldId('dep_self_lookup001')}`
      );
    });
  });

  describe('SchemaChecker', () => {
    const TABLE_NAME = 'test_schema_checker_rule';

    it('should report error when required column is missing', async () => {
      await createTestTable(TABLE_NAME);

      const fieldResult = createRealField('chk001', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();
      const table = createTableAggregate(TABLE_NAME, field);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      expect(results[0].ruleId).toBe(`column:${field.id().toString()}`);
    });

    it('should report success when required column exists', async () => {
      await createTestTable(TABLE_NAME, ['name_col TEXT']);

      const fieldResult = createRealField('chk002', 'Name', 'name_col');
      const field = fieldResult._unsafeUnwrap();
      const table = createTableAggregate(TABLE_NAME, field);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].ruleId).toBe(`column:${field.id().toString()}`);
    });

    it('should report generated-column metadata drift when field meta expects a stored column', async () => {
      await createTestTable(TABLE_NAME, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'chk003',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();
      const table = createTableAggregate(TABLE_NAME, field);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));

      expect(
        results.find((result) => result.ruleId === `generated_meta:${field.id().toString()}`)
          ?.status
      ).toBe('error');
      expect(
        results.find((result) => result.ruleId === `column:${field.id().toString()}`)?.status
      ).toBe('success');
    });
  });

  describe('LinkSymmetricFieldRule', () => {
    const TABLE_NAME = createValidTableId('symrule_current');
    const FOREIGN_TABLE_NAME = createValidTableId('symrule_foreign');

    it('ignores one-way fields when checking duplicate symmetric usage', async () => {
      await createTestTable(TABLE_NAME);
      await createTestTable(FOREIGN_TABLE_NAME);

      const field = createRealLinkField({
        id: 'symcurr1',
        name: 'Current Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: FOREIGN_TABLE_NAME,
        fkHostTableName: FOREIGN_TABLE_NAME,
        selfKeyName: '__fk_symcurr1',
        foreignKeyName: '__id',
        symmetricFieldId: createValidFieldId('symback1'),
      })._unsafeUnwrap();
      const symmetricFieldId = field.symmetricFieldId()?.toString();
      expect(symmetricFieldId).toBeTruthy();

      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${symmetricFieldId!},
          'Back Link',
          'link',
          ${JSON.stringify({ symmetricFieldId: field.id().toString() })},
          ${FOREIGN_TABLE_NAME}
        )
      `.execute(db);
      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${createValidFieldId('symdup01')},
          'Legacy One Way',
          'link',
          ${JSON.stringify({ symmetricFieldId, isOneWay: true })},
          ${TABLE_NAME}
        )
      `.execute(db);

      const rule = LinkSymmetricFieldRule.forField(field as LinkField);
      expect(rule).toBeDefined();
      if (!rule) {
        return;
      }

      const result = await rule.isValid(createContext(TABLE_NAME, field));
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(true);
    });

    it('returns duplicate conflict values using the keys expected by the UI', async () => {
      await createTestTable(TABLE_NAME);
      await createTestTable(FOREIGN_TABLE_NAME);

      const field = createRealLinkField({
        id: 'symcurr2',
        name: 'Current Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: FOREIGN_TABLE_NAME,
        fkHostTableName: FOREIGN_TABLE_NAME,
        selfKeyName: '__fk_symcurr2',
        foreignKeyName: '__id',
        symmetricFieldId: createValidFieldId('symback2'),
      })._unsafeUnwrap();
      const symmetricFieldId = field.symmetricFieldId()?.toString();
      expect(symmetricFieldId).toBeTruthy();

      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${symmetricFieldId!},
          'Back Link',
          'link',
          ${JSON.stringify({ symmetricFieldId: field.id().toString() })},
          ${FOREIGN_TABLE_NAME}
        )
      `.execute(db);
      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${createValidFieldId('symdup02')},
          'Competing Link',
          'link',
          ${JSON.stringify({ symmetricFieldId })},
          ${TABLE_NAME}
        )
      `.execute(db);

      const rule = LinkSymmetricFieldRule.forField(field as LinkField);
      expect(rule).toBeDefined();
      if (!rule) {
        return;
      }

      const result = await rule.isValid(createContext(TABLE_NAME, field));
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().valid).toBe(false);
      expect(result._unsafeUnwrap().missingItems?.[0]?.message.values).toEqual({
        symmetricFieldId,
        conflictFieldName: 'Competing Link',
      });
    });
  });

  describe('repair hints for high-risk rules', () => {
    it('explains fk-column repair uses the stored link value column as recovery source', () => {
      const field = createRealField('fkhint1', 'Link', 'link_col')._unsafeUnwrap();
      const rule = FkColumnRule.forField(field, 'fk_link_col', 'target_table');

      const repairHint = rule.getRepairHint({} as SchemaRuleContext, { valid: false });

      expect(repairHint.isOk()).toBe(true);
      expect(repairHint._unsafeUnwrap()).toMatchObject({
        available: true,
        mode: 'auto',
        description: {
          fallback: expect.stringContaining('underlying table as the recovery source'),
        },
      });
    });

    it('explains junction-table repair only reconstructs relations that still exist in stored link values', () => {
      const field = createRealLinkField({
        id: 'jhint01',
        name: 'Projects',
        dbFieldName: 'projects_link',
        relationship: 'manyMany',
        foreignTableId: createValidTableId('projects'),
        fkHostTableName: 'projects_junction',
        selfKeyName: 'task_id',
        foreignKeyName: 'project_id',
      })._unsafeUnwrap() as LinkField;

      const rule = new JunctionTableExistsRule(field, {
        junctionTable: { schema: TEST_SCHEMA, tableName: 'projects_junction' },
        selfKeyName: 'task_id',
        foreignKeyName: 'project_id',
        sourceTable: { schema: TEST_SCHEMA, tableName: 'tasks' },
        foreignTable: { schema: TEST_SCHEMA, tableName: 'projects' },
        withIndexes: true,
      });

      const repairHint = rule.getRepairHint({} as SchemaRuleContext, { valid: false });

      expect(repairHint.isOk()).toBe(true);
      expect(repairHint._unsafeUnwrap()).toMatchObject({
        available: true,
        mode: 'auto',
        description: {
          fallback: expect.stringContaining('Missing historical links cannot be recovered'),
        },
      });
    });

    it('explains link-value-column repair may still leave display values empty or stale', () => {
      const field = createRealField('lvhint1', 'Link Display', 'link_display_col')._unsafeUnwrap();
      const rule = LinkValueColumnRule.forField(field, 'twoWay');

      const repairHint = rule.getRepairHint({} as SchemaRuleContext, { valid: false });

      expect(repairHint.isOk()).toBe(true);
      expect(repairHint._unsafeUnwrap()).toMatchObject({
        available: true,
        mode: 'auto',
        description: {
          fallback: expect.stringContaining('display empty or stale values'),
        },
      });
    });

    it('explains generated-column-meta repair discards old generated display values when recreating a stored column', () => {
      const field = createCreatedTimeFieldWithGeneratedMeta(
        'gchint1',
        'Created At',
        'created_at_copy',
        true
      )._unsafeUnwrap();
      const generatedRule = GeneratedColumnRule.forCreatedTime(field);
      const rule = new GeneratedColumnMetaRule(field, generatedRule, generatedRule);

      const repairHint = rule.getRepairHint({} as SchemaRuleContext, { valid: false });

      expect(repairHint.isOk()).toBe(true);
      expect(repairHint._unsafeUnwrap()).toMatchObject({
        available: true,
        mode: 'auto',
        description: {
          fallback: expect.stringContaining('old generated display values'),
        },
      });
    });
  });

  describe('SchemaRepairer', () => {
    const expectRuleRepairLifecycle = async (params: {
      table: Table;
      fieldId: string;
      ruleId: string;
      expectedStatus?: 'warn' | 'error';
      manualRepairValues?: Record<string, string | boolean>;
      verifyAfterRepair?: () => Promise<void>;
    }) => {
      const {
        table,
        fieldId,
        ruleId,
        expectedStatus = 'error',
        manualRepairValues,
        verifyAfterRepair,
      } = params;

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const initialCheckResults = await collectFinalResults(checker.checkField(table, fieldId));

      expect(initialCheckResults.find((result) => result.ruleId === ruleId)?.status).toBe(
        expectedStatus
      );

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, fieldId, ruleId, {
          manualRepairValues,
        })
      );

      expect(repairResults.find((result) => result.ruleId === ruleId)?.status).toBe('success');
      expect(repairResults.find((result) => result.ruleId === ruleId)?.outcome).toBe('repaired');

      const repairedCheckResults = await collectFinalResults(checker.checkField(table, fieldId));
      expect(repairedCheckResults.find((result) => result.ruleId === ruleId)?.status).toBe(
        'success'
      );

      if (verifyAfterRepair) {
        await verifyAfterRepair();
      }
    };

    it('should keep manual rules in manual state until repair values are provided', async () => {
      const tableName = createValidTableId('smreq_current');
      const foreignTableName = createValidTableId('smreq_foreign');
      await createTestTable(tableName);
      await createTestTable(foreignTableName);

      const field = createRealLinkField({
        id: createValidFieldId('symmreq1'),
        name: 'Current Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: foreignTableName,
        fkHostTableName: foreignTableName,
        selfKeyName: '__fk_symmreq1',
        foreignKeyName: '__id',
        symmetricFieldId: createValidFieldId('symmreq2'),
      })._unsafeUnwrap();
      const symmetricFieldId = field.symmetricFieldId()?.toString();
      const table = createTableAggregate(tableName, field);

      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${symmetricFieldId!},
          'Back Link',
          'link',
          ${JSON.stringify({ symmetricFieldId: field.id().toString() })},
          ${foreignTableName}
        )
      `.execute(db);
      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${createValidFieldId('symmreq3')},
          'Competing Link',
          'link',
          ${JSON.stringify({ symmetricFieldId })},
          ${table.id().toString()}
        )
      `.execute(db);
      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const ruleId = `symmetric_field:${field.id().toString()}`;
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, field.id().toString(), ruleId)
      );

      expect(repairResults.find((result) => result.ruleId === ruleId)?.status).toBe('warn');
      expect(repairResults.find((result) => result.ruleId === ruleId)?.outcome).toBe('manual');
    });

    it('should execute manual repair through the rule for symmetric field conflicts', async () => {
      const tableName = createValidTableId('smrun_current');
      const foreignTableName = createValidTableId('smrun_foreign');
      await createTestTable(tableName);
      await createTestTable(foreignTableName);

      const field = createRealLinkField({
        id: createValidFieldId('symmrun1'),
        name: 'Current Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: foreignTableName,
        fkHostTableName: foreignTableName,
        selfKeyName: '__fk_symmrun1',
        foreignKeyName: '__id',
        symmetricFieldId: createValidFieldId('symmrun2'),
      })._unsafeUnwrap();
      const symmetricFieldId = field.symmetricFieldId()?.toString();
      const duplicateFieldId = createValidFieldId('symmrun3');
      const table = createTableAggregate(tableName, field);

      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${symmetricFieldId!},
          'Back Link',
          'link',
          ${JSON.stringify({ symmetricFieldId: field.id().toString() })},
          ${foreignTableName}
        )
      `.execute(db);
      await sql`
        INSERT INTO field (id, name, type, options, table_id)
        VALUES (
          ${duplicateFieldId},
          'Competing Link',
          'link',
          ${JSON.stringify({ symmetricFieldId })},
          ${table.id().toString()}
        )
      `.execute(db);
      const ruleId = `symmetric_field:${field.id().toString()}`;

      await expectRuleRepairLifecycle({
        table,
        fieldId: field.id().toString(),
        ruleId,
        manualRepairValues: {
          resolution: 'keep_current_link',
        },
        verifyAfterRepair: async () => {
          const duplicateField = await db
            .selectFrom('field')
            .select(['options'])
            .where('id', '=', duplicateFieldId)
            .executeTakeFirstOrThrow();

          const parsedOptions =
            typeof duplicateField.options === 'string'
              ? JSON.parse(duplicateField.options)
              : duplicateField.options;

          expect(parsedOptions).toMatchObject({
            symmetricFieldId,
            isOneWay: true,
          });
        },
      });
    });

    it('should report missing system __id uniqueness when checking system rules', async () => {
      const tableName = 'test_schema_system_rule_check';
      await createExplicitTestTable(tableName, [
        '__id TEXT NOT NULL',
        '__auto_number SERIAL PRIMARY KEY',
        '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT NOT NULL',
        '__last_modified_by TEXT',
        '__version INTEGER NOT NULL',
        'name_col TEXT',
      ]);

      const field = createRealField('sys001', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, SYSTEM_RULE_FIELD_ID));
      const uniqueRule = results.find((result) => result.ruleId === 'system_unique:__id');

      expect(uniqueRule?.status).toBe('error');
      expect(uniqueRule?.details?.missing).toContain(
        'system column "__id" should have UNIQUE index'
      );
    });

    it('should error when system __auto_number primary key is missing', async () => {
      const tableName = 'test_schema_system_primary_key_warn';
      await createExplicitTestTable(tableName, [
        '__id TEXT NOT NULL UNIQUE',
        '__auto_number INTEGER',
        '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT NOT NULL',
        '__last_modified_by TEXT',
        '__version INTEGER NOT NULL',
        'name_col TEXT',
      ]);

      const field = createRealField('sys001b', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalResults(checker.checkField(table, SYSTEM_RULE_FIELD_ID));
      const primaryKeyRule = results.find(
        (result) => result.ruleId === 'system_primary_key:__auto_number'
      );

      expect(primaryKeyRule?.status).toBe('error');
      expect(primaryKeyRule?.details?.missing).toContain(
        'system column "__auto_number" should be PRIMARY KEY'
      );
    });

    it('should repair system columns when repairing the system rule scope', async () => {
      const tableName = 'test_schema_system_repair_scope';
      await createExplicitTestTable(tableName, [
        '__id TEXT',
        '__auto_number INTEGER',
        '__created_time TIMESTAMPTZ',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT',
        '__last_modified_by TEXT',
        '__version INTEGER',
        'name_col TEXT',
      ]);

      const field = createRealField('sys002', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, SYSTEM_RULE_FIELD_ID)
      );

      expect(
        repairResults.some(
          (result) => result.ruleId === 'system_unique:__id' && result.outcome === 'repaired'
        )
      ).toBe(true);
      expect(
        repairResults.some(
          (result) =>
            result.ruleId === 'system_primary_key:__auto_number' && result.outcome === 'repaired'
        )
      ).toBe(true);

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });
      const checkResults = await collectFinalResults(
        checker.checkField(table, SYSTEM_RULE_FIELD_ID)
      );
      expect(checkResults.every((result) => result.status === 'success')).toBe(true);
    });

    it('should repair a single system rule using the system scope id', async () => {
      const tableName = 'test_schema_system_rule_repair';
      await createExplicitTestTable(tableName, [
        '__id TEXT NOT NULL',
        '__auto_number SERIAL PRIMARY KEY',
        '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '__last_modified_time TIMESTAMPTZ',
        '__created_by TEXT NOT NULL',
        '__last_modified_by TEXT',
        '__version INTEGER NOT NULL',
        'title_col TEXT',
      ]);

      const field = createRealField('sys003', 'Title', 'title_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, SYSTEM_RULE_FIELD_ID, 'system_unique:__id')
      );

      expect(repairResults.find((result) => result.ruleId === 'system_unique:__id')?.outcome).toBe(
        'repaired'
      );

      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });
      const checkResults = await collectFinalResults(
        checker.checkField(table, SYSTEM_RULE_FIELD_ID)
      );
      expect(checkResults.find((result) => result.ruleId === 'system_unique:__id')?.status).toBe(
        'success'
      );
    });

    it('should repair a missing column when repairing a table', async () => {
      const tableName = 'test_schema_repair_table';
      await createTestTable(tableName);

      const field = createRealField('rpt001', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(repairer.repairTable(table));

      expect(
        results.find((result) => result.ruleId === `column:${field.id().toString()}`)?.status
      ).toBe('success');
      expect(
        results.find((result) => result.ruleId === `column:${field.id().toString()}`)?.outcome
      ).toBe('repaired');

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(checkResults.every((result) => result.status === 'success')).toBe(true);
    });

    it('should include repair hint metadata in check results for failing auto-repair rules', async () => {
      const tableName = 'test_schema_check_repair_hint';
      await createTestTable(tableName);

      const field = createRealField('hint001', 'Name', 'name_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });

      const results = await collectFinalResults(checker.checkField(table, field.id().toString()));
      const columnRule = results.find(
        (result) => result.ruleId === `column:${field.id().toString()}`
      );

      expect(columnRule?.status).toBe('error');
      expect(columnRule?.repair).toMatchObject({
        available: true,
        mode: 'auto',
        reason: {
          fallback: 'Automatic repair will recreate the missing physical column for "Name".',
        },
      });
    });

    it('should repair a missing column when repairing a field', async () => {
      const tableName = 'test_schema_repair_field';
      await createTestTable(tableName);

      const field = createRealField('rpf001', 'Title', 'title_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(results[0].outcome).toBe('repaired');
      expect(results[0].ruleId).toBe(`column:${field.id().toString()}`);
    });

    it('should skip error repairs when targetStatuses only includes warnings', async () => {
      const tableName = 'test_schema_repair_target_status';
      await createTestTable(tableName);

      const field = createRealField('target001', 'Title', 'title_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(
        repairer.repairRule(table, field.id().toString(), `column:${field.id().toString()}`, {
          targetStatuses: ['warn'],
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('skipped');
      expect(results[0].outcome).toBe('skipped');

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(
        checkResults.find((result) => result.ruleId === `column:${field.id().toString()}`)?.status
      ).toBe('error');
    });

    it('should expose unrecoverable foreign key issues during check and skip repair', async () => {
      const sourceTableName = 'test_schema_fk_unavailable_source';
      const targetTableName = createValidTableId('tgt_fk_unavailable');
      const fkColumnName = '__fk_unavailable_rule';

      await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);

      const field = createRealLinkField({
        id: 'fkunava1',
        name: 'Unavailable FK Rule',
        dbFieldName: 'link_value',
        relationship: 'manyOne',
        foreignTableId: targetTableName,
        fkHostTableName: sourceTableName,
        selfKeyName: '__id',
        foreignKeyName: fkColumnName,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const checkResult = checkResults.find(
        (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
      );

      expect(checkResult?.status).toBe('warn');
      expect(checkResult?.repair).toEqual({
        available: false,
        mode: 'auto',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.foreignKeyTargetTableMissing',
          values: {
            fieldName: 'Unavailable FK Rule',
            targetTableName: targetTableName,
          },
          fallback:
            'Automatic repair is unavailable because the linked table for "Unavailable FK Rule" is missing.',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.foreignKeyTargetTableMissing',
          values: {
            fieldName: 'Unavailable FK Rule',
            targetTableName: targetTableName,
            targetPhysicalTableName: targetTableName,
          },
          fallback: `Check whether the linked table "${targetTableName}" was deleted or renamed. Recreate the table, or update/remove the link field configuration for "Unavailable FK Rule", then run the check again.`,
        },
      });

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(
          table,
          field.id().toString(),
          `fk:${field.id().toString()}:${fkColumnName}`
        )
      );
      const repairResult = repairResults.find(
        (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
      );

      expect(repairResult?.status).toBe('skipped');
      expect(repairResult?.outcome).toBe('skipped');
      expect(repairResult?.message).toBe('Skipped: repair unavailable');
      expect(repairResult?.repair?.available).toBe(false);
    });

    it('should expose orphaned foreign key rows during check and skip repair', async () => {
      const sourceTableName = 'test_schema_fk_orphan_source';
      const targetTableName = createValidTableId('tgt_fk_orphan');
      const fkColumnName = '__fk_orphan_rule';

      await createTestTable(targetTableName);
      await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);
      await sql
        .raw(
          `INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, "${fkColumnName}") VALUES ('src_001', 'missing_target_001')`
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'fkorphan1',
        name: 'Orphan FK Rule',
        dbFieldName: 'link_value',
        relationship: 'manyOne',
        foreignTableId: targetTableName,
        fkHostTableName: sourceTableName,
        selfKeyName: '__id',
        foreignKeyName: fkColumnName,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const checkResult = checkResults.find(
        (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
      );

      expect(checkResult?.status).toBe('warn');
      expect(checkResult?.repair).toEqual({
        available: false,
        mode: 'auto',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.foreignKeyOrphanRows',
          values: {
            fieldName: 'Orphan FK Rule',
            targetTableName: targetTableName,
            count: 1,
          },
          fallback:
            'Automatic repair is unavailable because "Orphan FK Rule" still has invalid linked rows.',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.foreignKeyOrphanRows',
          values: {
            fieldName: 'Orphan FK Rule',
            targetTableName: targetTableName,
            count: 1,
          },
          fallback:
            'Clean up the invalid linked rows for "Orphan FK Rule" before adding the foreign key constraint again.',
        },
      });

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(
          table,
          field.id().toString(),
          `fk:${field.id().toString()}:${fkColumnName}`
        )
      );
      const repairResult = repairResults.find(
        (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
      );

      expect(repairResult?.status).toBe('skipped');
      expect(repairResult?.outcome).toBe('skipped');
      expect(repairResult?.message).toBe('Skipped: repair unavailable');
      expect(repairResult?.repair?.available).toBe(false);
    });

    it('should expose orphaned junction foreign key rows during check and skip repair', async () => {
      const sourceTableName = createValidTableId('src_junction_unavail');
      const targetTableName = createValidTableId('tgt_junction_unavail');
      const junctionTableName = 'junction_unavailable_rule';
      const selfKeyName = '__fk_unavailable_self';
      const foreignKeyName = '__fk_unavailable_foreign';

      await createTestTable(sourceTableName);
      await createTestTable(targetTableName);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `"${selfKeyName}" TEXT`,
        `"${foreignKeyName}" TEXT`,
        '__order DOUBLE PRECISION',
      ]);
      await sql
        .raw(`INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id) VALUES ('src_001')`)
        .execute(db);
      await sql
        .raw(
          `INSERT INTO ${TEST_SCHEMA}.${junctionTableName} ("${selfKeyName}", "${foreignKeyName}") VALUES ('src_001', 'missing_target_001')`
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'jctorphan1',
        name: 'Orphan Junction FK Rule',
        dbFieldName: 'link_value',
        relationship: 'manyMany',
        foreignTableId: targetTableName,
        fkHostTableName: junctionTableName,
        selfKeyName,
        foreignKeyName,
        hasOrderColumn: true,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const checkResult = checkResults.find(
        (result) => result.ruleId === `junction_fk:${field.id().toString()}:foreign`
      );

      expect(checkResult?.status).toBe('warn');
      expect(checkResult?.repair).toEqual({
        available: false,
        mode: 'auto',
        reason: {
          key: 'table:table.integrity.v2.repairMeta.reason.junctionForeignKeyOrphanRows',
          values: {
            fieldName: 'Orphan Junction FK Rule',
            targetTableName: targetTableName,
            count: 1,
          },
          fallback:
            'Automatic repair is unavailable because the junction rows for "Orphan Junction FK Rule" still contain invalid references.',
        },
        description: {
          key: 'table:table.integrity.v2.repairMeta.description.junctionForeignKeyOrphanRows',
          values: {
            fieldName: 'Orphan Junction FK Rule',
            targetTableName: targetTableName,
            count: 1,
          },
          fallback:
            'Clean up the invalid junction rows for "Orphan Junction FK Rule" before adding the foreign key back.',
        },
      });

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(
          table,
          field.id().toString(),
          `junction_fk:${field.id().toString()}:foreign`
        )
      );
      const repairResult = repairResults.find(
        (result) => result.ruleId === `junction_fk:${field.id().toString()}:foreign`
      );

      expect(repairResult?.status).toBe('skipped');
      expect(repairResult?.outcome).toBe('skipped');
      expect(repairResult?.message).toBe('Skipped: repair unavailable');
      expect(repairResult?.repair?.available).toBe(false);
    });

    it('should repair generated-column metadata drift for stored columns', async () => {
      const tableName = 'test_schema_repair_generated_meta';
      await createTestTable(tableName, [
        '__created_time TIMESTAMPTZ DEFAULT NOW()',
        'created_time_col TIMESTAMPTZ GENERATED ALWAYS AS (__created_time) STORED',
      ]);

      const field = createCreatedTimeFieldWithGeneratedMeta(
        'rpg001',
        'CreatedTime',
        'created_time_col',
        false
      )._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const results = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        results.find((result) => result.ruleId === `generated_meta:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(checkResults.every((result) => result.status === 'success')).toBe(true);
    });

    it('should repair a many-one link FK index that is incorrectly unique', async () => {
      const sourceTableName = createValidTableId('src_many_one_unique_idx');
      const targetTableName = createValidTableId('tgt_many_one_unique_idx');
      const fkColumnName = '__fk_many_one_unique_idx';
      const indexRuleName = `index_${fkColumnName}`;

      await createTestTable(targetTableName);
      await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);
      await sql
        .raw(
          `ALTER TABLE ${TEST_SCHEMA}.${sourceTableName}
           ADD CONSTRAINT "${indexRuleName}" UNIQUE ("${fkColumnName}")`
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rpuniqueidx1',
        name: 'ManyOne Link',
        dbFieldName: 'link_value',
        relationship: 'manyOne',
        foreignTableId: targetTableName,
        fkHostTableName: sourceTableName,
        selfKeyName: '__id',
        foreignKeyName: fkColumnName,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);
      const ruleId = `index:${field.id().toString()}:${fkColumnName}`;

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const initialCheckResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const initialIndexResult = initialCheckResults.find((result) => result.ruleId === ruleId);

      expect(initialIndexResult?.status).toBe('warn');
      expect(initialIndexResult?.details).toMatchObject({
        missing: [`non-unique index ${indexRuleName}`],
        extra: [`unique constraint or index ${indexRuleName}`],
      });
      await expect(constraintExists(sourceTableName, indexRuleName)).resolves.toBe(true);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, field.id().toString(), ruleId)
      );
      const repairResult = repairResults.find((result) => result.ruleId === ruleId);

      expect(repairResult?.status).toBe('success');
      expect(repairResult?.outcome).toBe('repaired');
      await expect(constraintExists(sourceTableName, indexRuleName)).resolves.toBe(false);

      const repairedIndex = (
        await introspector.getIndex(TEST_SCHEMA, indexRuleName)
      )._unsafeUnwrap();
      expect(repairedIndex).toMatchObject({
        columnNames: [fkColumnName],
        isUnique: false,
      });

      const repairedCheckResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(repairedCheckResults.find((result) => result.ruleId === ruleId)?.status).toBe(
        'success'
      );
    });

    it.each([
      {
        label: 'manyOne',
        relationship: 'manyOne' as const,
        fieldSeed: 'rplink_many_one',
        fkColumnName: '__fk_many_one',
        expectUnique: false,
      },
      {
        label: 'oneOne',
        relationship: 'oneOne' as const,
        fieldSeed: 'rplink_one_one',
        fkColumnName: '__fk_one_one',
        expectUnique: true,
      },
    ])(
      'should repair a dropped FK column and backfill persisted link values for $label links',
      async ({ fieldSeed, relationship, fkColumnName, expectUnique }) => {
        const sourceTableName = createValidTableId(`src_${fieldSeed}`);
        const targetTableName = createValidTableId(`tgt_${fieldSeed}`);

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB', `${fkColumnName} TEXT`]);

        await sql
          .raw(
            `
            INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
            VALUES ('rec_target_a'), ('rec_target_b')
          `
          )
          .execute(db);
        await sql
          .raw(
            `
            INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value, "${fkColumnName}")
            VALUES
              ('rec_source_a', '{"id":"rec_target_a","title":"Target A"}'::jsonb, 'rec_target_a'),
              ('rec_source_b', '{"id":"rec_target_b","title":"Target B"}'::jsonb, 'rec_target_b')
          `
          )
          .execute(db);

        const field = createRealLinkField({
          id: fieldSeed,
          name: `${relationship} Link`,
          dbFieldName: 'link_value',
          relationship,
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${sourceTableName} DROP COLUMN "${fkColumnName}" CASCADE`
          )
          .execute(db);

        const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
        const repairResults = await collectFinalRepairResults(
          repairer.repairField(table, field.id().toString())
        );

        expect(
          repairResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
            ?.outcome
        ).toBe('repaired');

        const repairedRows = await sql<{ record_id: string; fk_value: string | null }>`
          SELECT __id AS record_id, ${sql.id(fkColumnName)} AS fk_value
          FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
          ORDER BY __id
        `.execute(db);

        expect(repairedRows.rows).toEqual([
          { record_id: 'rec_source_a', fk_value: 'rec_target_a' },
          { record_id: 'rec_source_b', fk_value: 'rec_target_b' },
        ]);

        const sourceRows = await sql<{ record_id: string; link_value: unknown }>`
          SELECT __id AS record_id, link_value
          FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
          ORDER BY __id
        `.execute(db);

        expect(sourceRows.rows).toEqual([
          {
            record_id: 'rec_source_a',
            link_value: { id: 'rec_target_a', title: 'Target A' },
          },
          {
            record_id: 'rec_source_b',
            link_value: { id: 'rec_target_b', title: 'Target B' },
          },
        ]);

        const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
        const checkResults = await collectFinalResults(
          checker.checkField(table, field.id().toString())
        );

        expect(
          checkResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
            ?.status
        ).toBe('success');
        expect(
          checkResults.find(
            (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
          )?.status
        ).toBe('success');

        const expectedIndexRuleId = expectUnique
          ? `unique_index:${field.id().toString()}:${fkColumnName}`
          : `index:${field.id().toString()}:${fkColumnName}`;
        expect(checkResults.find((result) => result.ruleId === expectedIndexRuleId)?.status).toBe(
          'success'
        );
      }
    );

    it('should repair the FK host column for two-way oneMany links from the source link JSON copy', async () => {
      const sourceTableName = createValidTableId('src_one_many_two_way');
      const targetTableName = createValidTableId('tgt_one_many_two_way');
      const hostFkColumnName = '__fk_one_many_host';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName, [`${hostFkColumnName} TEXT`]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_a","title":"Target A"},{"id":"rec_target_b","title":"Target B"}]'::jsonb),
            ('rec_source_b', '[{"id":"rec_target_c","title":"Target C"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id, "${hostFkColumnName}")
          VALUES
            ('rec_target_a', 'rec_source_a'),
            ('rec_target_b', 'rec_source_a'),
            ('rec_target_c', 'rec_source_b')
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rplink_one_many_two_way',
        name: 'OneMany Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: targetTableName,
        fkHostTableName: targetTableName,
        selfKeyName: hostFkColumnName,
        foreignKeyName: '__id',
        isOneWay: false,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      await sql
        .raw(
          `ALTER TABLE ${TEST_SCHEMA}.${targetTableName} DROP COLUMN "${hostFkColumnName}" CASCADE`
        )
        .execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const repairedRows = await sql<{ record_id: string; fk_value: string | null }>`
        SELECT __id AS record_id, ${sql.id(hostFkColumnName)} AS fk_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(targetTableName)}
        ORDER BY __id
      `.execute(db);

      expect(repairedRows.rows).toEqual([
        { record_id: 'rec_target_a', fk_value: 'rec_source_a' },
        { record_id: 'rec_target_b', fk_value: 'rec_source_a' },
        { record_id: 'rec_target_c', fk_value: 'rec_source_b' },
      ]);

      const sourceRows = await sql<{ record_id: string; link_value: unknown }>`
        SELECT __id AS record_id, link_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
        ORDER BY __id
      `.execute(db);

      expect(sourceRows.rows).toEqual([
        {
          record_id: 'rec_source_a',
          link_value: [
            { id: 'rec_target_a', title: 'Target A' },
            { id: 'rec_target_b', title: 'Target B' },
          ],
        },
        {
          record_id: 'rec_source_b',
          link_value: [{ id: 'rec_target_c', title: 'Target C' }],
        },
      ]);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      expect(
        checkResults.find(
          (result) => result.ruleId === `fk:${field.id().toString()}:${hostFkColumnName}`
        )?.status
      ).toBe('success');
      expect(
        checkResults.find(
          (result) => result.ruleId === `index:${field.id().toString()}:${hostFkColumnName}`
        )?.status
      ).toBe('success');
    });

    it('should repair a dropped junction table and backfill one-way oneMany link rows', async () => {
      const sourceTableName = createValidTableId('src_one_many_one_way');
      const targetTableName = createValidTableId('tgt_one_many_one_way');
      const junctionTableName = 'junction_one_many_one_way';
      const selfKeyName = '__fk_one_way_self';
      const foreignKeyName = '__fk_one_way_foreign';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `${selfKeyName} TEXT`,
        `${foreignKeyName} TEXT`,
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_a","title":"Target A"},{"id":"rec_target_b","title":"Target B"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
          VALUES ('rec_target_a'), ('rec_target_b')
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${junctionTableName} (${selfKeyName}, ${foreignKeyName})
          VALUES ('rec_source_a', 'rec_target_a'), ('rec_source_a', 'rec_target_b')
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rplink_one_many_one_way',
        name: 'OneWay OneMany Link',
        dbFieldName: 'link_value',
        relationship: 'oneMany',
        foreignTableId: targetTableName,
        fkHostTableName: junctionTableName,
        selfKeyName,
        foreignKeyName,
        isOneWay: true,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      await sql.raw(`DROP TABLE ${TEST_SCHEMA}.${junctionTableName}`).execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const junctionRows = await sql<{ self_id: string; foreign_id: string }>`
        SELECT ${sql.id(selfKeyName)} AS self_id, ${sql.id(foreignKeyName)} AS foreign_id
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(junctionTableName)}
        ORDER BY ${sql.id(selfKeyName)}, ${sql.id(foreignKeyName)}
      `.execute(db);

      expect(junctionRows.rows).toEqual([
        { self_id: 'rec_source_a', foreign_id: 'rec_target_a' },
        { self_id: 'rec_source_a', foreign_id: 'rec_target_b' },
      ]);

      const sourceRows = await sql<{ link_value: unknown }>`
        SELECT link_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
        WHERE __id = 'rec_source_a'
      `.execute(db);

      expect(sourceRows.rows[0]?.link_value).toEqual([
        { id: 'rec_target_a', title: 'Target A' },
        { id: 'rec_target_b', title: 'Target B' },
      ]);
    });

    it('should repair a dropped junction table and backfill manyMany link rows with order', async () => {
      const sourceTableName = createValidTableId('src_many_many_repair');
      const targetTableName = createValidTableId('tgt_many_many_repair');
      const junctionTableName = 'junction_many_many_repair';
      const selfKeyName = '__fk_many_many_self';
      const foreignKeyName = '__fk_many_many_foreign';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `${selfKeyName} TEXT`,
        `${foreignKeyName} TEXT`,
        '__order DOUBLE PRECISION',
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_b","title":"Target B"},{"id":"rec_target_a","title":"Target A"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
          VALUES ('rec_target_a'), ('rec_target_b')
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${junctionTableName} (${selfKeyName}, ${foreignKeyName}, "__order")
          VALUES ('rec_source_a', 'rec_target_b', 1), ('rec_source_a', 'rec_target_a', 2)
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'rplink_many_many',
        name: 'ManyMany Link',
        dbFieldName: 'link_value',
        relationship: 'manyMany',
        foreignTableId: targetTableName,
        fkHostTableName: junctionTableName,
        selfKeyName,
        foreignKeyName,
        hasOrderColumn: true,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);

      await sql.raw(`DROP TABLE ${TEST_SCHEMA}.${junctionTableName}`).execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const junctionRows = await sql<{ self_id: string; foreign_id: string; order_value: number }>`
        SELECT
          ${sql.id(selfKeyName)} AS self_id,
          ${sql.id(foreignKeyName)} AS foreign_id,
          "__order" AS order_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(junctionTableName)}
        ORDER BY "__order"
      `.execute(db);

      expect(junctionRows.rows).toEqual([
        { self_id: 'rec_source_a', foreign_id: 'rec_target_b', order_value: 1 },
        { self_id: 'rec_source_a', foreign_id: 'rec_target_a', order_value: 2 },
      ]);

      const sourceRows = await sql<{ link_value: unknown }>`
        SELECT link_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
        WHERE __id = 'rec_source_a'
      `.execute(db);

      expect(sourceRows.rows[0]?.link_value).toEqual([
        { id: 'rec_target_b', title: 'Target B' },
        { id: 'rec_target_a', title: 'Target A' },
      ]);
    });

    it('should not backfill a repaired junction table from an ambiguous shared link value column', async () => {
      const sourceTableName = createValidTableId('src_many_many_ambiguous');
      const targetTableName = createValidTableId('tgt_many_many_ambiguous');
      const junctionTableName = 'junction_many_many_ambiguous';
      const selfKeyName = '__fk_many_many_ambiguous_self';
      const foreignKeyName = '__fk_many_many_ambiguous_foreign';

      await createTestTable(sourceTableName, ['link_value JSONB']);
      await createTestTable(targetTableName);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `${selfKeyName} TEXT`,
        `${foreignKeyName} TEXT`,
        '__order DOUBLE PRECISION',
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES ('rec_source_a', '[{"id":"rec_target_a","title":"Target A"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
          VALUES ('rec_target_a')
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: 'ambiguousA',
        name: 'ManyMany Ambiguous Link',
        dbFieldName: 'link_value',
        relationship: 'manyMany',
        foreignTableId: targetTableName,
        fkHostTableName: junctionTableName,
        selfKeyName,
        foreignKeyName,
        hasOrderColumn: true,
      })._unsafeUnwrap();
      const table = createTableAggregate(sourceTableName, field);
      const sourceTableId = table.id().toString();

      await sql`
        INSERT INTO field (id, name, type, table_id, db_field_name)
        VALUES
          (${field.id().toString()}, 'ManyMany Ambiguous Link', 'link', ${sourceTableId}, 'link_value'),
          (${createValidFieldId('otherLinkB')}, 'Other Link', 'link', ${sourceTableId}, 'link_value')
      `.execute(db);

      await sql.raw(`DROP TABLE ${TEST_SCHEMA}.${junctionTableName}`).execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(table, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const junctionRows = await sql<{ self_id: string; foreign_id: string }>`
        SELECT
          ${sql.id(selfKeyName)} AS self_id,
          ${sql.id(foreignKeyName)} AS foreign_id
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(junctionTableName)}
      `.execute(db);

      expect(junctionRows.rows).toEqual([]);

      await sql`DELETE FROM field WHERE table_id = ${sourceTableId}`.execute(db);
    });

    it('should preserve FK-backed link values after repair and computed backfill', async () => {
      const sourceTableName = createValidTableId('src_fk_recompute');
      const targetTableName = createValidTableId('tgt_fk_recompute');
      const fkColumnName = '__fk_recompute_link';
      const fieldSeed = 'rpfkrecompute';
      const lookupFieldId = createValidFieldId(`lookup_${fieldSeed}`);

      await createTestTable(targetTableName, [
        '__version INTEGER DEFAULT 1',
        '__auto_number INTEGER',
        'title_col TEXT',
      ]);
      await createTestTable(sourceTableName, [
        '__version INTEGER DEFAULT 1',
        'link_value JSONB',
        `"${fkColumnName}" TEXT`,
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id, __auto_number, title_col)
          VALUES ('rec_target_a', 1, 'Target A'), ('rec_target_b', 2, 'Target B')
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value, "${fkColumnName}")
          VALUES
            ('rec_source_a', '{"id":"rec_target_a","title":"Target A"}'::jsonb, 'rec_target_a'),
            ('rec_source_b', '{"id":"rec_target_b","title":"Target B"}'::jsonb, 'rec_target_b')
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: fieldSeed,
        name: 'FK Recompute Link',
        dbFieldName: 'link_value',
        relationship: 'manyOne',
        foreignTableId: targetTableName,
        fkHostTableName: `${TEST_SCHEMA}.${sourceTableName}`,
        selfKeyName: '__id',
        foreignKeyName: fkColumnName,
        hasOrderColumn: false,
      })._unsafeUnwrap();
      const titleField = createRealFieldWithFieldId(
        lookupFieldId,
        'Title',
        'title_col'
      )._unsafeUnwrap();
      const sourceTable = createTableAggregateWithId(sourceTableName, sourceTableName, [field]);
      const targetTable = createTableAggregateWithId(
        targetTableName,
        targetTableName,
        [titleField],
        titleField.id()
      );

      await sql
        .raw(`ALTER TABLE ${TEST_SCHEMA}.${sourceTableName} DROP COLUMN "${fkColumnName}" CASCADE`)
        .execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(sourceTable, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const backfillService = createComputedBackfillService([targetTable]);
      const backfillResult = await backfillService.backfillMany({} as never, {
        table: sourceTable,
        fields: [field],
      });

      expect(backfillResult.isOk()).toBe(true);

      const sourceRows = await sql<{ record_id: string; link_value: unknown }>`
        SELECT __id AS record_id, link_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
        ORDER BY __id
      `.execute(db);

      expect(sourceRows.rows).toEqual([
        {
          record_id: 'rec_source_a',
          link_value: { id: 'rec_target_a', title: 'Target A' },
        },
        {
          record_id: 'rec_source_b',
          link_value: { id: 'rec_target_b', title: 'Target B' },
        },
      ]);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(sourceTable, field.id().toString())
      );
      expect(
        checkResults.find((result) => result.ruleId === `fk_column:${field.id().toString()}`)
          ?.status
      ).toBe('success');
      expect(
        checkResults.find(
          (result) => result.ruleId === `fk:${field.id().toString()}:${fkColumnName}`
        )?.status
      ).toBe('success');
    });

    it('should preserve junction-backed link values after repair and computed backfill', async () => {
      const sourceTableName = createValidTableId('src_junction_recompute');
      const targetTableName = createValidTableId('tgt_junction_recompute');
      const junctionTableName = 'junction_recompute_link';
      const selfKeyName = '__fk_recompute_self';
      const foreignKeyName = '__fk_recompute_foreign';
      const fieldSeed = 'rpjctrecompute';
      const lookupFieldId = createValidFieldId(`lookup_${fieldSeed}`);

      await createTestTable(sourceTableName, ['__version INTEGER DEFAULT 1', 'link_value JSONB']);
      await createTestTable(targetTableName, [
        '__version INTEGER DEFAULT 1',
        '__auto_number INTEGER',
        'title_col TEXT',
      ]);
      await createExplicitTestTable(junctionTableName, [
        '__id SERIAL PRIMARY KEY',
        `"${selfKeyName}" TEXT`,
        `"${foreignKeyName}" TEXT`,
        '__order DOUBLE PRECISION',
      ]);

      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
          VALUES
            ('rec_source_a', '[{"id":"rec_target_b","title":"Target B"},{"id":"rec_target_a","title":"Target A"}]'::jsonb)
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id, __auto_number, title_col)
          VALUES ('rec_target_a', 1, 'Target A'), ('rec_target_b', 2, 'Target B')
        `
        )
        .execute(db);
      await sql
        .raw(
          `
          INSERT INTO ${TEST_SCHEMA}.${junctionTableName} ("${selfKeyName}", "${foreignKeyName}", "__order")
          VALUES ('rec_source_a', 'rec_target_b', 1), ('rec_source_a', 'rec_target_a', 2)
        `
        )
        .execute(db);

      const field = createRealLinkField({
        id: fieldSeed,
        name: 'Junction Recompute Link',
        dbFieldName: 'link_value',
        relationship: 'manyMany',
        foreignTableId: targetTableName,
        fkHostTableName: `${TEST_SCHEMA}.${junctionTableName}`,
        selfKeyName,
        foreignKeyName,
        hasOrderColumn: true,
      })._unsafeUnwrap();
      const titleField = createRealFieldWithFieldId(
        lookupFieldId,
        'Title',
        'title_col'
      )._unsafeUnwrap();
      const sourceTable = createTableAggregateWithId(sourceTableName, sourceTableName, [field]);
      const targetTable = createTableAggregateWithId(
        targetTableName,
        targetTableName,
        [titleField],
        titleField.id()
      );

      await sql.raw(`DROP TABLE ${TEST_SCHEMA}.${junctionTableName}`).execute(db);

      const repairer = createSchemaRepairer({ db, introspector, schema: TEST_SCHEMA });
      const repairResults = await collectFinalRepairResults(
        repairer.repairField(sourceTable, field.id().toString())
      );

      expect(
        repairResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.outcome
      ).toBe('repaired');

      const backfillService = createComputedBackfillService([targetTable]);
      const backfillResult = await backfillService.backfillMany({} as never, {
        table: sourceTable,
        fields: [field],
      });

      expect(backfillResult.isOk()).toBe(true);

      const sourceRows = await sql<{ link_value: unknown }>`
        SELECT link_value
        FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
        WHERE __id = 'rec_source_a'
      `.execute(db);

      expect(sourceRows.rows[0]?.link_value).toEqual([
        { id: 'rec_target_b', title: 'Target B' },
        { id: 'rec_target_a', title: 'Target A' },
      ]);

      const checker = createSchemaChecker({ db, introspector, schema: TEST_SCHEMA });
      const checkResults = await collectFinalResults(
        checker.checkField(sourceTable, field.id().toString())
      );
      expect(
        checkResults.find((result) => result.ruleId === `junction_table:${field.id().toString()}`)
          ?.status
      ).toBe('success');
      expect(
        checkResults.find((result) => result.ruleId === `junction_fk:${field.id().toString()}:self`)
          ?.status
      ).toBe('success');
      expect(
        checkResults.find(
          (result) => result.ruleId === `junction_fk:${field.id().toString()}:foreign`
        )?.status
      ).toBe('success');
    });

    it('should repair a single reference rule using a checker-provided rule id', async () => {
      const tableName = 'test_schema_repair_rule';
      await createTestTable(tableName, ['lookup_col TEXT']);

      const field = createLookupField('rpr001', 'Lookup', 'lookup_col')._unsafeUnwrap();
      const table = createTableAggregate(tableName, field);
      const checker = createSchemaChecker({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });

      const checkResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const ruleId = checkResults.find(
        (result) =>
          result.ruleId ===
          `reference:${field.id().toString()}:${createValidFieldId('lookup_rpr001')}`
      )?.ruleId;

      expect(ruleId).toBeDefined();

      const repairer = createSchemaRepairer({
        db,
        introspector,
        schema: TEST_SCHEMA,
      });
      const repairResults = await collectFinalRepairResults(
        repairer.repairRule(table, field.id().toString(), ruleId!)
      );

      expect(repairResults).toHaveLength(1);
      expect(repairResults[0].status).toBe('success');
      expect(repairResults[0].outcome).toBe('repaired');
      expect(repairResults[0].ruleId).toBe(ruleId);

      const repairedCheckResults = await collectFinalResults(
        checker.checkField(table, field.id().toString())
      );
      const repairedRule = repairedCheckResults.find((result) => result.ruleId === ruleId);
      expect(repairedRule?.status).toBe('success');
    });

    describe('rule-specific auto repair coverage', () => {
      it('should repair a missing system column through repairRule', async () => {
        const tableName = 'test_schema_system_column_rule';
        await createExplicitTestTable(tableName, [
          '__id TEXT NOT NULL UNIQUE',
          '__auto_number SERIAL PRIMARY KEY',
          '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
          '__created_by TEXT NOT NULL',
          '__last_modified_by TEXT',
          '__version INTEGER NOT NULL',
          'name_col TEXT',
        ]);

        const field = createRealField('syscol001', 'Name', 'name_col')._unsafeUnwrap();
        const table = createTableAggregate(tableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: SYSTEM_RULE_FIELD_ID,
          ruleId: 'system_column:__last_modified_time',
        });
      });

      it('should repair a missing system NOT NULL constraint through repairRule', async () => {
        const tableName = 'test_schema_system_not_null_rule';
        await createExplicitTestTable(tableName, [
          '__id TEXT NOT NULL UNIQUE',
          '__auto_number SERIAL PRIMARY KEY',
          '__created_time TIMESTAMPTZ NOT NULL DEFAULT NOW()',
          '__last_modified_time TIMESTAMPTZ',
          '__created_by TEXT NOT NULL',
          '__last_modified_by TEXT',
          '__version INTEGER',
          'name_col TEXT',
        ]);

        const field = createRealField('sysnn001', 'Name', 'name_col')._unsafeUnwrap();
        const table = createTableAggregate(tableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: SYSTEM_RULE_FIELD_ID,
          ruleId: 'system_not_null:__version',
        });
      });

      it('should repair a missing system default through repairRule', async () => {
        const tableName = 'test_schema_system_default_rule';
        await createExplicitTestTable(tableName, [
          '__id TEXT NOT NULL UNIQUE',
          '__auto_number SERIAL PRIMARY KEY',
          '__created_time TIMESTAMPTZ NOT NULL',
          '__last_modified_time TIMESTAMPTZ',
          '__created_by TEXT NOT NULL',
          '__last_modified_by TEXT',
          '__version INTEGER NOT NULL',
          'name_col TEXT',
        ]);

        const field = createRealField('sysdef001', 'Name', 'name_col')._unsafeUnwrap();
        const table = createTableAggregate(tableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: SYSTEM_RULE_FIELD_ID,
          ruleId: 'system_default:__created_time',
        });
      });

      it('should repair a missing optional column unique rule through repairRule', async () => {
        const tableName = 'test_schema_column_unique_rule';
        await createTestTable(tableName, ['email_col TEXT']);

        const field = createRealField('coluniq01', 'Email', 'email_col', {
          unique: true,
        })._unsafeUnwrap();
        const table = createTableAggregate(tableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `column_unique:${field.id().toString()}`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing NOT NULL rule through repairRule', async () => {
        const tableName = 'test_schema_not_null_rule';
        await createTestTable(tableName, ['name_col TEXT']);

        const field = createRealField('notnull01', 'Name', 'name_col', {
          notNull: true,
        })._unsafeUnwrap();
        const table = createTableAggregate(tableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `not_null:${field.id().toString()}`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing generated column through repairRule', async () => {
        const tableName = 'test_schema_generated_column_rule';
        await createTestTable(tableName, ['__created_time TIMESTAMPTZ DEFAULT NOW()']);

        const field = createCreatedTimeFieldWithGeneratedMeta(
          'gencol01',
          'CreatedTime',
          'created_time_col',
          true
        )._unsafeUnwrap();
        const table = createTableAggregate(tableName, field);

        await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'CreatedTime', '{}') ON CONFLICT (id) DO NOTHING`.execute(
          db
        );

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `generated_column:${field.id().toString()}`,
        });
      });

      it('should repair a missing link value column through repairRule', async () => {
        const sourceTableName = createValidTableId('src_link_value_rule');
        const targetTableName = createValidTableId('tgt_link_value_rule');

        await createTestTable(sourceTableName);
        await createTestTable(targetTableName);

        const field = createRealLinkField({
          id: 'lnkval001',
          name: 'Link Value Rule',
          dbFieldName: 'link_value',
          relationship: 'oneMany',
          foreignTableId: targetTableName,
          fkHostTableName: 'junction_link_value_rule',
          selfKeyName: '__fk_link_value_self',
          foreignKeyName: '__fk_link_value_foreign',
          isOneWay: true,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `link_value_column:${field.id().toString()}`,
        });
      });

      it('should repair a missing foreign key column through repairRule', async () => {
        const sourceTableName = createValidTableId('src_fk_column_rule');
        const targetTableName = createValidTableId('tgt_fk_column_rule');
        const fkColumnName = '__fk_column_rule';

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB']);
        await sql
          .raw(
            `
            INSERT INTO ${TEST_SCHEMA}.${sourceTableName} (__id, link_value)
            VALUES ('rec_source_a', '{"id":"rec_target_a","title":"Target A"}'::jsonb)
          `
          )
          .execute(db);
        await sql
          .raw(
            `
            INSERT INTO ${TEST_SCHEMA}.${targetTableName} (__id)
            VALUES ('rec_target_a')
          `
          )
          .execute(db);

        const field = createRealLinkField({
          id: 'fkcol001',
          name: 'FK Column Rule',
          dbFieldName: 'link_value',
          relationship: 'manyOne',
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `fk_column:${field.id().toString()}`,
          expectedStatus: 'warn',
          verifyAfterRepair: async () => {
            const rows = await sql<{ fk_value: string | null }>`
              SELECT ${sql.id(fkColumnName)} AS fk_value
              FROM ${sql.id(TEST_SCHEMA)}.${sql.id(sourceTableName)}
              WHERE __id = 'rec_source_a'
            `.execute(db);

            expect(rows.rows[0]?.fk_value).toBe('rec_target_a');
          },
        });
      });

      it('should repair a missing index rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_index_rule');
        const targetTableName = createValidTableId('tgt_index_rule');
        const fkColumnName = '__fk_index_rule';

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);

        const field = createRealLinkField({
          id: 'index001',
          name: 'Index Rule',
          dbFieldName: 'link_value',
          relationship: 'manyOne',
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `index:${field.id().toString()}:${fkColumnName}`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing unique index rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_unique_index_rule');
        const targetTableName = createValidTableId('tgt_unique_index_rule');
        const fkColumnName = '__fk_unique_index_rule';

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);

        const field = createRealLinkField({
          id: 'uidxrl01',
          name: 'Unique Index Rule',
          dbFieldName: 'link_value',
          relationship: 'oneOne',
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `unique_index:${field.id().toString()}:${fkColumnName}`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing foreign key constraint rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_foreign_key_rule');
        const targetTableName = createValidTableId('tgt_foreign_key_rule');
        const fkColumnName = '__fk_foreign_key_rule';

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);

        const field = createRealLinkField({
          id: 'fkcnst01',
          name: 'Foreign Key Rule',
          dbFieldName: 'link_value',
          relationship: 'manyOne',
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `fk:${field.id().toString()}:${fkColumnName}`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing order column rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_order_rule');
        const targetTableName = createValidTableId('tgt_order_rule');
        const fkColumnName = '__fk_order_rule';
        const orderColumnName = '__fk_order_rule_order';

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, ['link_value JSONB', `"${fkColumnName}" TEXT`]);

        const field = createRealLinkField({
          id: 'order001',
          name: 'Order Rule',
          dbFieldName: 'link_value',
          relationship: 'manyOne',
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: true,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `order_column:${field.id().toString()}`,
          verifyAfterRepair: async () => {
            const column = await introspector.getColumn(
              TEST_SCHEMA,
              sourceTableName,
              orderColumnName
            );
            expect(column._unsafeUnwrap()).toBeTruthy();
          },
        });
      });

      it('should repair missing field metadata through repairRule', async () => {
        const sourceTableName = createValidTableId('src_field_meta_rule');
        const targetTableName = createValidTableId('tgt_field_meta_rule');
        const fkColumnName = '__fk_field_meta_rule';
        const orderColumnName = '__fk_field_meta_rule_order';

        await createTestTable(targetTableName);
        await createTestTable(sourceTableName, [
          'link_value JSONB',
          `"${fkColumnName}" TEXT`,
          `"${orderColumnName}" DOUBLE PRECISION`,
        ]);

        const field = createRealLinkField({
          id: 'fldmeta01',
          name: 'Field Meta Rule',
          dbFieldName: 'link_value',
          relationship: 'manyOne',
          foreignTableId: targetTableName,
          fkHostTableName: sourceTableName,
          selfKeyName: '__id',
          foreignKeyName: fkColumnName,
          hasOrderColumn: true,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await sql`INSERT INTO field (id, name, meta) VALUES (${field.id().toString()}, 'Field Meta Rule', '{}') ON CONFLICT (id) DO UPDATE SET meta = '{}'`.execute(
          db
        );

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `field_meta:${field.id().toString()}`,
          verifyAfterRepair: async () => {
            const record = await sql<{ meta: string | Record<string, unknown> }>`
              SELECT meta
              FROM field
              WHERE id = ${field.id().toString()}
            `.execute(db);
            const meta =
              typeof record.rows[0]?.meta === 'string'
                ? JSON.parse(record.rows[0].meta)
                : record.rows[0]?.meta;

            expect(meta).toMatchObject({ hasOrderColumn: true });
          },
        });
      });

      it('should repair a missing junction table unique rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_junction_unique_rule');
        const targetTableName = createValidTableId('tgt_junction_unique_rule');
        const junctionTableName = 'junction_unique_rule';
        const selfKeyName = '__fk_junction_unique_self';
        const foreignKeyName = '__fk_junction_unique_foreign';

        await createTestTable(sourceTableName, ['link_value JSONB']);
        await createTestTable(targetTableName);
        await createExplicitTestTable(junctionTableName, [
          '__id SERIAL PRIMARY KEY',
          `${selfKeyName} TEXT`,
          `${foreignKeyName} TEXT`,
        ]);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT fk_${selfKeyName}
             FOREIGN KEY (${selfKeyName}) REFERENCES ${TEST_SCHEMA}.${sourceTableName}(__id) ON DELETE CASCADE`
          )
          .execute(db);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT fk_${foreignKeyName}
             FOREIGN KEY (${foreignKeyName}) REFERENCES ${TEST_SCHEMA}.${targetTableName}(__id) ON DELETE CASCADE`
          )
          .execute(db);

        const field = createRealLinkField({
          id: 'jctuniq01',
          name: 'Junction Unique Rule',
          dbFieldName: 'link_value',
          relationship: 'oneMany',
          foreignTableId: targetTableName,
          fkHostTableName: junctionTableName,
          selfKeyName,
          foreignKeyName,
          isOneWay: true,
          hasOrderColumn: false,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `junction_unique:${field.id().toString()}`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing junction index rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_junction_index_rule');
        const targetTableName = createValidTableId('tgt_junction_index_rule');
        const junctionTableName = 'junction_index_rule';
        const selfKeyName = '__fk_junction_index_self';
        const foreignKeyName = '__fk_junction_index_foreign';

        await createTestTable(sourceTableName, ['link_value JSONB']);
        await createTestTable(targetTableName);
        await createExplicitTestTable(junctionTableName, [
          '__id SERIAL PRIMARY KEY',
          `${selfKeyName} TEXT`,
          `${foreignKeyName} TEXT`,
          '__order DOUBLE PRECISION',
        ]);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT uniq_${selfKeyName}_${foreignKeyName} UNIQUE (${selfKeyName}, ${foreignKeyName})`
          )
          .execute(db);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT fk_${selfKeyName}
             FOREIGN KEY (${selfKeyName}) REFERENCES ${TEST_SCHEMA}.${sourceTableName}(__id) ON DELETE CASCADE`
          )
          .execute(db);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT fk_${foreignKeyName}
             FOREIGN KEY (${foreignKeyName}) REFERENCES ${TEST_SCHEMA}.${targetTableName}(__id) ON DELETE CASCADE`
          )
          .execute(db);

        const field = createRealLinkField({
          id: 'jctidx001',
          name: 'Junction Index Rule',
          dbFieldName: 'link_value',
          relationship: 'manyMany',
          foreignTableId: targetTableName,
          fkHostTableName: junctionTableName,
          selfKeyName,
          foreignKeyName,
          hasOrderColumn: true,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `junction_index:${field.id().toString()}:self`,
          expectedStatus: 'warn',
        });
      });

      it('should repair a missing junction foreign key rule through repairRule', async () => {
        const sourceTableName = createValidTableId('src_junction_fk_rule');
        const targetTableName = createValidTableId('tgt_junction_fk_rule');
        const junctionTableName = 'junction_fk_rule';
        const selfKeyName = '__fk_junction_fk_self';
        const foreignKeyName = '__fk_junction_fk_foreign';

        await createTestTable(sourceTableName, ['link_value JSONB']);
        await createTestTable(targetTableName);
        await createExplicitTestTable(junctionTableName, [
          '__id SERIAL PRIMARY KEY',
          `${selfKeyName} TEXT`,
          `${foreignKeyName} TEXT`,
          '__order DOUBLE PRECISION',
        ]);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT uniq_${selfKeyName}_${foreignKeyName} UNIQUE (${selfKeyName}, ${foreignKeyName})`
          )
          .execute(db);
        await sql
          .raw(
            `CREATE INDEX index_${selfKeyName} ON ${TEST_SCHEMA}.${junctionTableName}(${selfKeyName})`
          )
          .execute(db);
        await sql
          .raw(
            `CREATE INDEX index_${foreignKeyName} ON ${TEST_SCHEMA}.${junctionTableName}(${foreignKeyName})`
          )
          .execute(db);
        await sql
          .raw(
            `ALTER TABLE ${TEST_SCHEMA}.${junctionTableName}
             ADD CONSTRAINT fk_${foreignKeyName}
             FOREIGN KEY (${foreignKeyName}) REFERENCES ${TEST_SCHEMA}.${targetTableName}(__id) ON DELETE CASCADE`
          )
          .execute(db);

        const field = createRealLinkField({
          id: 'jctfk001',
          name: 'Junction Foreign Key Rule',
          dbFieldName: 'link_value',
          relationship: 'manyMany',
          foreignTableId: targetTableName,
          fkHostTableName: junctionTableName,
          selfKeyName,
          foreignKeyName,
          hasOrderColumn: true,
        })._unsafeUnwrap();
        const table = createTableAggregate(sourceTableName, field);

        await expectRuleRepairLifecycle({
          table,
          fieldId: field.id().toString(),
          ruleId: `junction_fk:${field.id().toString()}:self`,
          expectedStatus: 'warn',
        });
      });
    });
  });
});
