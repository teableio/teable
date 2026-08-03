import * as Sentry from '@sentry/nestjs';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createMetaRepairer,
  type MetaValidationIssue,
  type SchemaRepairResult,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  BaseId,
  FieldHasError,
  FieldId,
  FieldName,
  LinkFieldConfig,
  LookupOptions,
  Table,
  TableId,
  TableName,
  v2CoreTokens,
  type ITracer,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { IntegrityV2Service } from './integrity-v2.service';

const metaReferenceRuleId = 'meta:reference';
const schemaIntegrityRepairFeatureTag = 'schema-integrity-repair';
const repairRuleId = 'column:fldIntegrity0001';
const metaFieldId = 'fldIntegrity0001';
const repairFailureSpanName = 'teable.IntegrityV2Service.reportRepairFailure';
const integrityFailureKindAttribute = 'teable.integrity.failure_kind';
const integrityRuleIdAttribute = 'teable.integrity.rule_id';
const integrityScopeAttribute = 'teable.integrity.scope';
const integrityTargetIdAttribute = 'teable.integrity.target_id';
const repairStreamCrashedMessage = 'repair stream crashed';
const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createFieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const createBaseTablePreflightRow = (
  tableId: string,
  tableName: string,
  activeFieldCount: number,
  primaryFieldCount: number
) => ({
  tableId,
  tableName,
  activeFieldCount,
  primaryFieldCount,
});
const createMetaDb = (rows: ReadonlyArray<ReturnType<typeof createBaseTablePreflightRow>>) => {
  const query = {
    leftJoin: vi.fn(() => query),
    select: vi.fn(() => query),
    where: vi.fn(() => query),
    groupBy: vi.fn(() => query),
    execute: vi.fn().mockResolvedValue(rows),
  };
  return {
    selectFrom: vi.fn(() => query),
    query,
  };
};
const createThrowingRepairStream = (message: string): AsyncGenerator<SchemaRepairResult> =>
  ({
    async next() {
      throw new Error(message);
    },
    async return() {
      return {
        done: true,
        value: undefined,
      };
    },
    async throw(error) {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  }) as AsyncGenerator<SchemaRepairResult>;

class FakeSpan {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  errors: string[] = [];
  ended = false;

  constructor(name: string, attributes?: Record<string, string | number | boolean>) {
    this.name = name;
    this.attributes = attributes;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes = {
      ...(this.attributes ?? {}),
      [key]: value,
    };
  }

  setAttributes(attributes: Record<string, string | number | boolean>): void {
    this.attributes = {
      ...(this.attributes ?? {}),
      ...attributes,
    };
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  spans: FakeSpan[] = [];

  startSpan(name: string, attributes?: Record<string, string | number | boolean>) {
    const span = new FakeSpan(name, attributes);
    this.spans.push(span);
    return span;
  }

  async withSpan<T>(_span: FakeSpan, callback: () => Promise<T>): Promise<T> {
    return await callback();
  }

  getActiveSpan(): FakeSpan | undefined {
    return this.spans.at(-1);
  }
}

const sentryScope = {
  setLevel: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
};

vi.mock('@sentry/nestjs', () => ({
  withScope: (callback: (scope: typeof sentryScope) => void) => callback(sentryScope),
  captureException: vi.fn(),
}));

const createTable = (
  fields: unknown[] = [],
  options?: { tableId?: string; tableName?: string; baseId?: string }
): Table =>
  ({
    id: () => ({ toString: () => options?.tableId ?? 'tblIntegrity000001' }),
    name: () => ({ toString: () => options?.tableName ?? 'Tasks' }),
    baseId: () => ({ toString: () => options?.baseId ?? 'baseIntegrity0001' }),
    getFields: () => fields,
  }) as unknown as Table;

const createMetaIssue = (): MetaValidationIssue => ({
  fieldId: metaFieldId,
  fieldName: 'Status',
  fieldType: 'lookup',
  category: 'reference',
  severity: 'error',
  message: 'Link field not found: fldMissing',
  details: {
    relatedFieldId: 'fldMissing',
  },
});

const createMetaIssueStream = (issue: MetaValidationIssue): AsyncGenerator<MetaValidationIssue> =>
  (async function* () {
    yield issue;
  })();

const createRepairResult = (): SchemaRepairResult => ({
  id: 'tblIntegrity000001:rule:error',
  fieldId: metaFieldId,
  fieldName: 'Status',
  ruleId: repairRuleId,
  ruleDescription: 'Physical column "Status" (text)',
  status: 'error',
  outcome: 'unchanged',
  message: 'Schema repair failed',
  required: true,
  timestamp: Date.now(),
  dependencies: [],
  depth: 0,
  details: {
    statementCount: 1,
  },
});

const createEmptyRepairStream = (): AsyncGenerator<SchemaRepairResult> => ({
  async next() {
    return {
      done: true,
      value: undefined,
    };
  },
  async return() {
    return {
      done: true,
      value: undefined,
    };
  },
  async throw(error) {
    throw error;
  },
  [Symbol.asyncIterator]() {
    return this;
  },
});

const createFakeRepairDb = () => {
  const execute = vi.fn().mockResolvedValue([]);
  const compile = vi.fn(() => ({
    sql: 'update "field" set "has_error" = $1 where "id" = $2',
    parameters: [true, `fld${'l'.repeat(16)}`],
  }));
  const where = vi.fn(() => ({ compile, execute }));
  const set = vi.fn(() => ({ where }));
  const updateTable = vi.fn(() => ({ set }));

  return {
    db: { updateTable },
    execute,
    updateTable,
  };
};

const createCrossBaseLookupTables = () => {
  const hostBaseId = createBaseId('1');
  const foreignBaseId = createBaseId('2');
  const hostTableId = createTableId('h');
  const foreignTableId = createTableId('f');
  const hostPrimaryFieldId = createFieldId('p');
  const linkFieldId = createFieldId('r');
  const lookupFieldId = createFieldId('l');
  const foreignPrimaryFieldId = createFieldId('n');

  const foreignBuilder = Table.builder()
    .withBaseId(foreignBaseId)
    .withId(foreignTableId)
    .withName(TableName.create('Contracts')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(foreignPrimaryFieldId)
    .withName(FieldName.create('Contract Name')._unsafeUnwrap())
    .primary()
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  const foreignPrimaryField = foreignTable
    .getField((field) => field.id().equals(foreignPrimaryFieldId))
    ._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    baseId: foreignBaseId.toString(),
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignPrimaryFieldId.toString(),
    isOneWay: true,
  })._unsafeUnwrap();
  const lookupOptions = LookupOptions.create({
    linkFieldId: linkFieldId.toString(),
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: foreignPrimaryFieldId.toString(),
  })._unsafeUnwrap();

  const hostBuilder = Table.builder()
    .withBaseId(hostBaseId)
    .withId(hostTableId)
    .withName(TableName.create('Projects')._unsafeUnwrap());
  hostBuilder
    .field()
    .singleLineText()
    .withId(hostPrimaryFieldId)
    .withName(FieldName.create('Project Name')._unsafeUnwrap())
    .primary()
    .done();
  hostBuilder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Contract')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  hostBuilder
    .field()
    .lookup()
    .withId(lookupFieldId)
    .withName(FieldName.create('Contract Name Lookup')._unsafeUnwrap())
    .withLookupOptions(lookupOptions)
    .withInnerField(foreignPrimaryField)
    .done();
  hostBuilder.view().defaultGrid().done();
  const hostTable = hostBuilder.build()._unsafeUnwrap();
  const linkField = hostTable.getField((field) => field.id().equals(linkFieldId))._unsafeUnwrap();
  const lookupField = hostTable
    .getField((field) => field.id().equals(lookupFieldId))
    ._unsafeUnwrap();

  return {
    foreignBaseId,
    foreignTable,
    foreignTableId,
    hostTable,
    linkField,
    lookupField,
  };
};

const collect = async <T>(stream: AsyncGenerator<T, void, unknown>): Promise<T[]> => {
  const results: T[] = [];
  for await (const item of stream) {
    results.push(item);
  }
  return results;
};

describe('IntegrityV2Service repair telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads cross-base referenced tables so base repair does not mark valid lookups has_error', async () => {
    const { foreignBaseId, foreignTable, foreignTableId, hostTable, linkField, lookupField } =
      createCrossBaseLookupTables();
    const tableRepository = {
      find: vi.fn().mockResolvedValueOnce({
        isErr: () => false,
        value: [foreignTable],
      }),
    };
    const service = new IntegrityV2Service({} as never, {} as never);
    const schemaRepairer = {
      repairTable: vi.fn(() => createEmptyRepairStream()),
    };
    const fakeDb = createFakeRepairDb();
    const metaRepairer = createMetaRepairer({ db: fakeDb.db as never });

    const brokenContextResults = await collect(
      service['streamBaseRepairs'](
        [hostTable],
        [hostTable],
        schemaRepairer as never,
        metaRepairer,
        { targetStatuses: ['error'] },
        {
          scope: 'base',
          targetId: hostTable.baseId().toString(),
        }
      )
    );

    expect(brokenContextResults.map((result) => result.status)).toEqual([
      'running',
      'success',
      'running',
      'success',
    ]);
    expect(brokenContextResults[1]).toMatchObject({
      fieldId: linkField.id().toString(),
      ruleId: metaReferenceRuleId,
      outcome: 'repaired',
      message: 'Field marked hasError',
      details: {
        missing: [foreignTableId.toString()],
        statementCount: 1,
      },
    });
    expect(brokenContextResults[3]).toMatchObject({
      fieldId: lookupField.id().toString(),
      ruleId: metaReferenceRuleId,
      outcome: 'repaired',
      message: 'Field marked hasError',
      details: {
        missing: [foreignTableId.toString(), foreignTable.getFields()[0]?.id().toString()],
        statementCount: 1,
      },
    });
    expect(fakeDb.updateTable).toHaveBeenCalledWith('field');
    expect(fakeDb.execute).toHaveBeenCalledTimes(2);
    expect(linkField.hasError().isError()).toBe(true);
    expect(lookupField.hasError().isError()).toBe(true);

    linkField.setHasError(FieldHasError.ok());
    lookupField.setHasError(FieldHasError.ok());
    fakeDb.execute.mockClear();
    fakeDb.updateTable.mockClear();

    const metaTables = await service['loadReferencedForeignTables'](
      [hostTable],
      tableRepository as never,
      {} as never
    );
    const repairedContextResults = await collect(
      service['streamBaseRepairs'](
        [hostTable],
        metaTables,
        schemaRepairer as never,
        metaRepairer,
        { targetStatuses: ['error'] },
        {
          scope: 'base',
          targetId: hostTable.baseId().toString(),
        }
      )
    );

    expect(tableRepository.find).toHaveBeenCalledTimes(1);
    expect(tableRepository.find.mock.calls[0]?.[2]).toEqual({ state: 'activeWithPending' });
    expect(tableRepository.find.mock.calls[0]?.[1]).toMatchObject({
      left: {
        baseIdValue: foreignBaseId,
      },
      right: {
        tableIdsValue: [foreignTableId],
      },
    });
    expect(metaTables.map((table) => table.id().toString())).toContain(foreignTableId.toString());
    expect(repairedContextResults).toEqual([]);
    expect(fakeDb.execute).not.toHaveBeenCalled();
    expect(lookupField.hasError().isError()).toBe(false);
  });

  it('loads active schema state for integrity table targets', async () => {
    const tableId = createTableId('i').toString();
    const table = createTable();
    const tableRepository = {
      findOne: vi.fn().mockResolvedValue(ok(table)),
      find: vi.fn().mockResolvedValue(ok([table])),
    };
    const db = {};
    const container = {
      resolve: vi.fn((token) => {
        if (token === v2CoreTokens.tableRepository) {
          return tableRepository;
        }
        return db;
      }),
    };
    const service = new IntegrityV2Service(
      { getContainerForTable: vi.fn().mockResolvedValue(container) } as never,
      { createContext: vi.fn().mockResolvedValue({}) } as never
    );

    await service['resolveSchemaTarget'](tableId, { includeBaseTables: true });

    expect(tableRepository.findOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      state: 'activeWithPending',
    });
    expect(tableRepository.find).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      state: 'activeWithPending',
    });
  });

  it('loads active schema state for integrity base targets', async () => {
    const baseId = createBaseId('i').toString();
    const tableId = createTableId('i').toString();
    const table = createTable([], { tableId });
    const tableRepository = {
      find: vi.fn().mockResolvedValue(ok([table])),
    };
    const baseRepository = {
      findOne: vi.fn().mockResolvedValue(ok({})),
    };
    const metaDb = createMetaDb([
      createBaseTablePreflightRow(tableId, table.name().toString(), 1, 1),
    ]);
    const db = {};
    const container = {
      resolve: vi.fn((token) => {
        if (token === v2CoreTokens.tableRepository) {
          return tableRepository;
        }
        if (token === v2CoreTokens.baseRepository) {
          return baseRepository;
        }
        if (token === v2MetaDbTokens.db) {
          return metaDb;
        }
        return db;
      }),
    };
    const service = new IntegrityV2Service(
      { getContainerForBase: vi.fn().mockResolvedValue(container) } as never,
      { createContext: vi.fn().mockResolvedValue({}) } as never
    );

    const target = await service['resolveBaseTarget'](baseId);

    expect(target.tables).toEqual([table]);
    expect(target.preflightIssues).toEqual([]);
  });

  it('keeps active tables with no fields out of V2 hydration', async () => {
    const baseId = createBaseId('j').toString();
    const tableId = createTableId('j').toString();
    const table = createTable([], { tableId });
    const emptyTableId = createTableId('e').toString();
    const tableRepository = {
      find: vi.fn().mockResolvedValue(ok([table])),
    };
    const baseRepository = {
      findOne: vi.fn().mockResolvedValue(ok({})),
    };
    const metaDb = createMetaDb([
      createBaseTablePreflightRow(tableId, table.name().toString(), 1, 1),
      createBaseTablePreflightRow(emptyTableId, 'Empty Table', 0, 0),
    ]);
    const db = {};
    const container = {
      resolve: vi.fn((token) => {
        if (token === v2CoreTokens.tableRepository) {
          return tableRepository;
        }
        if (token === v2CoreTokens.baseRepository) {
          return baseRepository;
        }
        if (token === v2MetaDbTokens.db) {
          return metaDb;
        }
        return db;
      }),
    };
    const service = new IntegrityV2Service(
      { getContainerForBase: vi.fn().mockResolvedValue(container) } as never,
      { createContext: vi.fn().mockResolvedValue({}) } as never
    );

    const preflight = await service['inspectBaseTablesBeforeHydration'](
      metaDb,
      BaseId.create(baseId)._unsafeUnwrap()
    );
    const target = await service['resolveBaseTarget'](baseId);

    expect(target.tables).toEqual([table]);
    expect(target.preflightIssues).toEqual([]);
    expect(preflight.tableIds.map((tableId) => tableId.toString())).toEqual([
      table.id().toString(),
    ]);
    expect(preflight.issues).toEqual([]);
    expect(tableRepository.find).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      state: 'activeWithPending',
    });
  });

  it('reports active tables without a primary field while still hydrating them', async () => {
    const baseId = createBaseId('k').toString();
    const missingPrimaryTableId = createTableId('m').toString();
    const table = createTable([], { tableId: missingPrimaryTableId, tableName: 'Needs Primary' });
    const tableRepository = {
      find: vi.fn().mockResolvedValue(ok([table])),
    };
    const baseRepository = {
      findOne: vi.fn().mockResolvedValue(ok({})),
    };
    const metaDb = createMetaDb([
      createBaseTablePreflightRow(missingPrimaryTableId, 'Needs Primary', 2, 0),
    ]);
    const db = {};
    const container = {
      resolve: vi.fn((token) => {
        if (token === v2CoreTokens.tableRepository) {
          return tableRepository;
        }
        if (token === v2CoreTokens.baseRepository) {
          return baseRepository;
        }
        if (token === v2MetaDbTokens.db) {
          return metaDb;
        }
        return db;
      }),
    };
    const service = new IntegrityV2Service(
      { getContainerForBase: vi.fn().mockResolvedValue(container) } as never,
      { createContext: vi.fn().mockResolvedValue({}) } as never
    );

    const target = await service['resolveBaseTarget'](baseId);

    expect(target.tables).toEqual([table]);
    expect(target.preflightIssues).toHaveLength(1);
    expect(target.preflightIssues[0]).toMatchObject({
      baseId,
      tableId: missingPrimaryTableId,
      tableName: 'Needs Primary',
      fieldId: missingPrimaryTableId,
      fieldName: 'System Columns',
      ruleId: 'table_missing_primary_field',
      status: 'error',
      repair: {
        available: false,
        mode: 'manual',
      },
    });
    expect(tableRepository.find).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      state: 'activeWithPending',
    });
  });

  it('marks metadata reference check results as auto repairable', async () => {
    const service = new IntegrityV2Service({} as never, {} as never);
    const table = createTable();
    const issue = createMetaIssue();

    const stream = service['decorateMetaCheckStream'](
      table,
      createMetaIssueStream(issue),
      undefined
    );

    const results = await collect(stream);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      fieldId: issue.fieldId,
      ruleId: metaReferenceRuleId,
      status: 'error',
      repair: {
        available: true,
        mode: 'auto',
      },
    });
  });

  it('captures result-level repair failures to sentry and trace spans', async () => {
    const service = new IntegrityV2Service({} as never, {} as never);
    const tracer = new FakeTracer();
    const table = createTable();
    const result = createRepairResult();

    const stream = service['decorateRepairStream'](
      table,
      (async function* () {
        yield result;
      })(),
      undefined,
      {
        tracer,
        scope: 'table',
        targetId: table.id().toString(),
      }
    );

    const serialized = await collect(stream);

    expect(serialized).toHaveLength(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentryScope.setTag).toHaveBeenCalledWith('feature', schemaIntegrityRepairFeatureTag);
    expect(sentryScope.setTag).toHaveBeenCalledWith('integrity.failure_kind', 'result_error');
    expect(sentryScope.setContext).toHaveBeenCalledWith(
      'schema-integrity-repair',
      expect.objectContaining({
        tableId: 'tblIntegrity000001',
        ruleId: repairRuleId,
        failureKind: 'result_error',
      })
    );
    expect(tracer.spans[0]?.name).toBe(repairFailureSpanName);
    expect(tracer.spans[0]?.attributes).toMatchObject({
      [integrityFailureKindAttribute]: 'result_error',
      [integrityRuleIdAttribute]: repairRuleId,
      [integrityScopeAttribute]: 'table',
    });
    expect(tracer.spans[0]?.errors).toContain('Schema repair failed');
  });

  it('captures thrown repair stream exceptions to sentry and trace spans', async () => {
    const service = new IntegrityV2Service({} as never, {} as never);
    const tracer = new FakeTracer();
    const table = createTable();

    const stream = service['decorateRepairStream'](
      table,
      createThrowingRepairStream(repairStreamCrashedMessage),
      undefined,
      {
        tracer,
        scope: 'base',
        targetId: table.baseId().toString(),
      }
    );

    await expect(collect(stream)).rejects.toThrow(repairStreamCrashedMessage);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentryScope.setTag).toHaveBeenCalledWith('integrity.failure_kind', 'stream_exception');
    expect(tracer.spans[0]?.attributes).toMatchObject({
      [integrityFailureKindAttribute]: 'stream_exception',
      [integrityScopeAttribute]: 'base',
      [integrityTargetIdAttribute]: 'baseIntegrity0001',
    });
    expect(tracer.spans[0]?.errors).toContain(repairStreamCrashedMessage);
  });
});
