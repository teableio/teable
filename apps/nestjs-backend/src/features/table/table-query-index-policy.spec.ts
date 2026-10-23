import { FieldType } from '@teable/core';
import type {
  ITableQueryIndexPolicyRo,
  ITableQueryIndexPolicyVo,
  ITableQueryIndexSpec,
} from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sharp', () => ({ default: vi.fn() }));

vi.mock('@sentry/nestjs', () => ({
  withScope: vi.fn((callback: (scope: unknown) => void) =>
    callback({ setTag: vi.fn(), setContext: vi.fn(), setLevel: vi.fn() })
  ),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import { IndexBuilderPostgres } from '../../db-provider/search-query/search-index-builder.postgres';
import { TableIndexService } from './table-index.service';

const tableId = 'tblQueryIndexPolicy';
const dbTableName = 'bseQueryIndexPolicy.tblQueryIndexPolicy';

type FieldRow = {
  id: string;
  type: FieldType;
  dbFieldName: string;
  isMultipleCellValue: boolean;
  isLookup?: boolean;
  isConditionalLookup?: boolean;
};

const fieldSeed: FieldRow[] = [
  {
    id: 'fldCase',
    type: FieldType.SingleLineText,
    dbFieldName: 'Case_ID',
    isMultipleCellValue: false,
  },
  {
    id: 'fldStarted',
    type: FieldType.Date,
    dbFieldName: 'Started_At',
    isMultipleCellValue: false,
  },
  {
    id: 'fldLong',
    type: FieldType.LongText,
    dbFieldName: 'Summary_Markdown',
    isMultipleCellValue: false,
  },
];

const caseOnlyIndex: ITableQueryIndexSpec = {
  id: 'case_only',
  columns: [{ kind: 'field', fieldId: 'fldCase', direction: 'asc' }],
};

const caseStartedIndex: ITableQueryIndexSpec = {
  id: 'perf_case_started',
  columns: [
    { kind: 'field', fieldId: 'fldCase', direction: 'asc' },
    { kind: 'field', fieldId: 'fldStarted', direction: 'desc' },
  ],
};

const startedCoalesceIndex: ITableQueryIndexSpec = {
  id: 'sync_run_sort',
  columns: [
    {
      kind: 'coalesce',
      fieldIds: ['fldStarted', '__created_time'],
      direction: 'desc',
    },
    { kind: 'field', fieldId: '__id', direction: 'desc' },
  ],
};

const initialPolicy: ITableQueryIndexPolicyVo = {
  version: 1,
  indexes: [caseStartedIndex, startedCoalesceIndex, caseOnlyIndex],
};

const clone = <T>(value: T): T => structuredClone(value);

const flush = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(() => resolve(undefined));
  return promise;
};

type MetaWrite = { key: string; previous: unknown };

type FakeTransaction = {
  $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string) => Promise<void>;
  tableMeta: {
    findFirstOrThrow: (args?: {
      select?: Record<string, boolean>;
    }) => Promise<Record<string, unknown>>;
    update: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  };
  field: {
    findMany: (args?: { select?: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
  };
};

type LockRequest = { key: string; acquired: boolean };

type DataTransactionSnapshot = {
  indexes: string[];
  policy: ITableQueryIndexPolicyVo | null;
  lockHeld: boolean;
};

type PolicyWrite = {
  policy: ITableQueryIndexPolicyVo;
  lockHeld: boolean;
};

const createWorld = (input?: { policy?: ITableQueryIndexPolicyVo | null; fields?: FieldRow[] }) => {
  const builder = new IndexBuilderPostgres();
  const fields = (input?.fields ?? fieldSeed).map((field) => ({ ...field }));
  const meta: {
    dbTableName: string;
    queryIndexPolicy: ITableQueryIndexPolicyVo | null;
    [key: string]: unknown;
  } = {
    dbTableName,
    queryIndexPolicy: input?.policy ? clone(input.policy) : null,
  };

  const indexes = new Map<string, string>();
  const fieldNames = () => {
    const names = new Map<string, string>([
      ['__id', '__id'],
      ['__created_time', '__created_time'],
    ]);
    for (const field of fields) {
      names.set(field.id, field.dbFieldName);
    }
    return names;
  };

  const addPolicyIndexes = (policy: ITableQueryIndexPolicyVo) => {
    for (const index of policy.indexes) {
      indexes.set(
        builder.getQueryIndexName(tableId, index.id),
        builder.createQueryIndexSql(dbTableName, index, fieldNames(), tableId)
      );
    }
  };
  if (input?.policy) {
    addPolicyIndexes(input.policy);
  }

  const indexNames = () => [...indexes.keys()].sort();
  const expectedNames = (policy: { indexes: ITableQueryIndexSpec[] }) =>
    policy.indexes.map((index) => builder.getQueryIndexName(tableId, index.id)).sort();

  const applySql = (rawSql: string) => {
    const sql = rawSql.trim();
    if (sql.startsWith('DO $$')) {
      for (const name of [...indexes.keys()]) {
        if (name.startsWith('idx_qry_')) {
          indexes.delete(name);
        }
      }
      return;
    }
    const dropped = /^DROP INDEX IF EXISTS "[^"]+"\."([^"]+)"$/i.exec(sql);
    if (dropped) {
      indexes.delete(dropped[1]);
      return;
    }
    const created = /^CREATE INDEX IF NOT EXISTS "([^"]+)" ON /i.exec(sql);
    if (created) {
      indexes.set(created[1], sql);
      return;
    }
    throw new Error(`Unsupported query index SQL in test double: ${sql}`);
  };

  const dataTransactions: DataTransactionSnapshot[] = [];
  const policyWrites: PolicyWrite[] = [];
  const lockRequests: LockRequest[] = [];
  const lockWaiters: Array<{
    tx: FakeTransaction;
    request: LockRequest;
    resolve: (rows: { locked: boolean }[]) => void;
  }> = [];
  let lockOwner: FakeTransaction | null = null;

  const acquireLock = (tx: FakeTransaction, key: string): Promise<{ locked: boolean }[]> => {
    const request: LockRequest = { key, acquired: false };
    lockRequests.push(request);
    if (lockOwner === tx || lockOwner === null) {
      lockOwner = tx;
      request.acquired = true;
      return Promise.resolve([{ locked: true }]);
    }
    const { promise, resolve } = Promise.withResolvers<{ locked: boolean }[]>();
    lockWaiters.push({ tx, request, resolve });
    return promise;
  };

  const releaseLock = (tx: FakeTransaction) => {
    if (lockOwner !== tx) {
      return;
    }
    const next = lockWaiters.shift();
    if (!next) {
      lockOwner = null;
      return;
    }
    lockOwner = next.tx;
    next.request.acquired = true;
    next.resolve([{ locked: true }]);
  };

  const applyMetaWrite = (data: Record<string, unknown>, writes: MetaWrite[]) => {
    for (const [key, value] of Object.entries(data)) {
      writes.push({ key, previous: meta[key] });
      meta[key] = clone(value);
    }
  };

  const recordPolicyWrite = (data: Record<string, unknown>, lockHeld: boolean) => {
    if (!('queryIndexPolicy' in data)) {
      return;
    }
    policyWrites.push({
      policy: clone(data.queryIndexPolicy as ITableQueryIndexPolicyVo),
      lockHeld,
    });
  };

  const rollbackMetaWrites = (writes: MetaWrite[]) => {
    for (let i = writes.length - 1; i >= 0; i--) {
      meta[writes[i].key] = writes[i].previous;
    }
  };

  const findTableMeta = (select?: Record<string, boolean>) => {
    const row: Record<string, unknown> = {
      dbTableName: meta.dbTableName,
      queryIndexPolicy: clone(meta.queryIndexPolicy),
    };
    if (meta.searchIndexPolicy !== undefined) {
      row.searchIndexPolicy = clone(meta.searchIndexPolicy);
    }
    if (!select) {
      return row;
    }
    return Object.fromEntries(Object.entries(row).filter(([key]) => select[key]));
  };

  const findFields = (select?: Record<string, boolean>) =>
    fields.map((field) => {
      const row = { ...field } as Record<string, unknown>;
      if (!select) {
        return row;
      }
      return Object.fromEntries(Object.entries(row).filter(([key]) => select[key]));
    });

  const queryRaw = async (tx: FakeTransaction, sql: string, args: unknown[]): Promise<unknown> => {
    if (sql.includes('advisory_xact_lock')) {
      return acquireLock(tx, String(args[0]));
    }
    if (sql.includes('pg_indexes') && sql.includes('indexname')) {
      return [...indexes.keys()].map((indexname) => ({ indexname }));
    }
    return [];
  };

  const createTransaction = () => {
    const writes: MetaWrite[] = [];
    const tx = {} as FakeTransaction;
    tx.$queryRawUnsafe = (sql, ...args) => queryRaw(tx, sql, args);
    tx.$executeRawUnsafe = async (sql) => applySql(sql);
    tx.tableMeta = {
      findFirstOrThrow: async (args) => findTableMeta(args?.select),
      update: async ({ data }) => {
        applyMetaWrite(data, writes);
        recordPolicyWrite(data, lockOwner === tx);
        return findTableMeta();
      },
    };
    tx.field = {
      findMany: async (args) => clone(findFields(args?.select)),
    };
    return { tx, writes };
  };

  const transaction = async <T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> => {
    const { tx, writes } = createTransaction();
    try {
      return await callback(tx);
    } catch (error) {
      rollbackMetaWrites(writes);
      throw error;
    } finally {
      releaseLock(tx);
    }
  };

  const dataPrismaTransactionForTable = async <T>(
    _tableId: string,
    callback: (prisma: { $executeRawUnsafe: (sql: string) => Promise<void> }) => Promise<T>
  ): Promise<T> => {
    const snapshot = new Map(indexes);
    dataTransactions.push({
      indexes: indexNames(),
      policy: clone(meta.queryIndexPolicy),
      lockHeld: lockOwner !== null,
    });
    try {
      return await callback({
        $executeRawUnsafe: async (sql) => applySql(sql),
      });
    } catch (error) {
      indexes.clear();
      for (const [name, sql] of snapshot) {
        indexes.set(name, sql);
      }
      throw error;
    }
  };

  const databaseRouter = {
    dataPrismaTransactionForTable,
    executeDataPrismaForTable: async (_tableId: string, sql: string) => {
      applySql(sql);
    },
    queryDataPrismaForTable: async (_tableId: string, sql: string) => {
      if (sql.includes('pg_indexes') && sql.includes('indexname')) {
        return [...indexes.keys()].map((indexname) => ({ indexname }));
      }
      return [];
    },
  };

  const prismaService = {
    $transaction: transaction,
    tableMeta: {
      findFirstOrThrow: async (args?: { select?: Record<string, boolean> }) =>
        findTableMeta(args?.select),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        applyMetaWrite(data, []);
        recordPolicyWrite(data, false);
        return findTableMeta();
      },
    },
    field: {
      findMany: async (args?: { select?: Record<string, boolean> }) =>
        clone(findFields(args?.select)),
    },
    txClient: () => createTransaction().tx,
  };

  const service = new TableIndexService(
    {} as never,
    prismaService as never,
    databaseRouter as never,
    { bigTransactionTimeout: 5000 } as never,
    { searchIndex: () => builder } as never,
    undefined,
    undefined,
    undefined
  );

  return {
    builder,
    fields,
    meta,
    dataTransactions,
    policyWrites,
    lockRequests,
    indexNames,
    expectedNames,
    service,
  };
};

describe('query index policy', () => {
  it('defaults to no managed query indexes', async () => {
    const world = createWorld();

    await expect(world.service.getQueryIndexPolicy(tableId)).resolves.toEqual({
      version: 1,
      indexes: [],
    });
  });

  it('rejects duplicate index ids', async () => {
    const world = createWorld();

    await expect(
      world.service.updateQueryIndexPolicy(tableId, {
        indexes: [
          {
            id: 'duplicate',
            columns: [{ kind: 'field', fieldId: 'fldCase', direction: 'asc' }],
          },
          {
            id: 'duplicate',
            columns: [{ kind: 'field', fieldId: 'fldStarted', direction: 'desc' }],
          },
        ],
      })
    ).rejects.toThrow('Duplicate query index id: duplicate');
  });

  it('rejects a field that cannot be btree-indexed', async () => {
    const world = createWorld();

    await expect(
      world.service.updateQueryIndexPolicy(tableId, {
        indexes: [
          {
            id: 'long_text',
            columns: [{ kind: 'field', fieldId: 'fldLong', direction: 'asc' }],
          },
        ],
      })
    ).rejects.toThrow('Field is not eligible for a query index: fldLong');
  });

  it('rejects a coalesce column with a non-date field', async () => {
    const world = createWorld();

    await expect(
      world.service.updateQueryIndexPolicy(tableId, {
        indexes: [
          {
            id: 'bad_coalesce',
            columns: [
              {
                kind: 'coalesce',
                fieldIds: ['fldCase', '__created_time'],
                direction: 'desc',
              },
            ],
          },
        ],
      })
    ).rejects.toThrow('Field is not eligible for a coalesce query index: fldCase');
  });

  it('replaces managed indexes and persists the policy as one stateful operation', async () => {
    const legacyPolicy: ITableQueryIndexPolicyVo = {
      version: 1,
      indexes: [
        { id: 'legacy', columns: [{ kind: 'field', fieldId: 'fldStarted', direction: 'asc' }] },
      ],
    };
    const world = createWorld({ policy: legacyPolicy });
    const nextPolicy: ITableQueryIndexPolicyRo = {
      indexes: [caseStartedIndex, startedCoalesceIndex],
    };

    await expect(world.service.updateQueryIndexPolicy(tableId, nextPolicy)).resolves.toEqual({
      version: 1,
      indexes: nextPolicy.indexes,
    });

    expect(world.meta.queryIndexPolicy).toEqual({ version: 1, indexes: nextPolicy.indexes });
    expect(world.policyWrites).toEqual([
      { policy: { version: 1, indexes: nextPolicy.indexes }, lockHeld: true },
    ]);
    expect(world.indexNames()).toEqual(world.expectedNames(nextPolicy));
    await expect(world.service.getQueryIndexPolicy(tableId)).resolves.toEqual({
      version: 1,
      indexes: nextPolicy.indexes,
    });
  });

  it('removes dependent indexes for standalone v2 deletes without returning a policy payload', async () => {
    const world = createWorld({ policy: initialPolicy });
    const remaining: ITableQueryIndexPolicyVo = {
      version: 1,
      indexes: [caseOnlyIndex],
    };

    await expect(
      world.service.removeQueryIndexesForFieldStandalone(tableId, 'fldStarted')
    ).resolves.toBeUndefined();

    expect(world.meta.queryIndexPolicy).toEqual(remaining);
    expect(world.policyWrites).toEqual([{ policy: remaining, lockHeld: true }]);
    expect(world.indexNames()).toEqual(world.expectedNames(remaining));
  });

  it('restores physical indexes and leaves the stored policy untouched when conversion fails', async () => {
    const world = createWorld({ policy: initialPolicy });
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let duringConversion: { policy: unknown; indexes: string[] } | undefined;

    const conversion = world.service.withQueryIndexesForFieldConversion(
      tableId,
      'fldStarted',
      FieldType.LongText,
      async () => {
        duringConversion = {
          policy: clone(world.meta.queryIndexPolicy),
          indexes: world.indexNames(),
        };
        started.resolve(undefined);
        await gate.promise;
        throw new Error('conversion rejected');
      }
    );

    await started.promise;
    expect(duringConversion).toEqual({
      policy: initialPolicy,
      indexes: world.expectedNames({ indexes: [caseOnlyIndex] }),
    });
    expect(world.policyWrites).toHaveLength(0);

    const conversionRejects = expect(conversion).rejects.toThrow('conversion rejected');
    gate.reject(new Error('conversion rejected'));
    await conversionRejects;

    expect(world.meta.queryIndexPolicy).toEqual(initialPolicy);
    expect(world.policyWrites).toHaveLength(0);
    expect(world.indexNames()).toEqual(world.expectedNames(initialPolicy));
    await expect(world.service.getQueryIndexPolicy(tableId)).resolves.toEqual(initialPolicy);

    expect(world.dataTransactions).toHaveLength(2);
    expect(world.dataTransactions.map((transaction) => transaction.lockHeld)).toEqual([true, true]);
    expect(world.dataTransactions[0].indexes).toEqual(world.expectedNames(initialPolicy));
    expect(world.dataTransactions[1].indexes).toEqual(
      world.expectedNames({ indexes: [caseOnlyIndex] })
    );
  });

  const queuedPutCases: Array<{ label: string; policy: ITableQueryIndexPolicyRo }> = [
    {
      label: 'a replacement policy',
      policy: {
        indexes: [
          {
            id: 'put_case',
            columns: [{ kind: 'field', fieldId: 'fldCase', direction: 'asc' }],
          },
        ],
      },
    },
    { label: 'an explicitly empty policy', policy: { indexes: [] } },
  ];

  it.each(queuedPutCases)(
    'lets a queued PUT with $label win after a rejected conversion restored the indexes',
    async ({ policy }) => {
      const world = createWorld({ policy: initialPolicy });
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      let conversionPending = true;

      const conversion = world.service.withQueryIndexesForFieldConversion(
        tableId,
        'fldStarted',
        FieldType.LongText,
        async () => {
          started.resolve(undefined);
          await gate.promise;
          conversionPending = false;
          throw new Error('conversion failed');
        }
      );

      await started.promise;
      const put = world.service.updateQueryIndexPolicy(tableId, policy);
      await flush();

      expect(conversionPending).toBe(true);
      expect(world.lockRequests).toHaveLength(2);
      expect(world.lockRequests[1].acquired).toBe(false);
      expect(world.meta.queryIndexPolicy).toEqual(initialPolicy);
      expect(world.policyWrites).toHaveLength(0);
      expect(world.dataTransactions).toHaveLength(1);

      const conversionRejects = expect(conversion).rejects.toThrow('conversion failed');
      const putResolves = expect(put).resolves.toEqual({ version: 1, indexes: policy.indexes });
      gate.reject(new Error('conversion failed'));
      await conversionRejects;
      await putResolves;

      expect(world.meta.queryIndexPolicy).toEqual({ version: 1, indexes: policy.indexes });
      expect(world.policyWrites).toEqual([
        { policy: { version: 1, indexes: policy.indexes }, lockHeld: true },
      ]);
      expect(world.indexNames()).toEqual(world.expectedNames(policy));
      expect(world.dataTransactions).toHaveLength(3);
      expect(world.dataTransactions.map((transaction) => transaction.lockHeld)).toEqual([
        true,
        true,
        true,
      ]);
      expect(world.dataTransactions[2].indexes).toEqual(world.expectedNames(initialPolicy));
    }
  );

  it('removes dependent indexes after a successful conversion and validates a queued policy against the converted fields', async () => {
    const world = createWorld({ policy: initialPolicy });
    const started = Promise.withResolvers<void>();
    const mutateFields = Promise.withResolvers<void>();
    let duringConversion: { policy: unknown; indexes: string[] } | undefined;

    const conversion = world.service.withQueryIndexesForFieldConversion(
      tableId,
      'fldStarted',
      FieldType.LongText,
      async () => {
        duringConversion = {
          policy: clone(world.meta.queryIndexPolicy),
          indexes: world.indexNames(),
        };
        started.resolve(undefined);
        await mutateFields.promise;
        const startedField = world.fields.find((field) => field.id === 'fldStarted');
        if (!startedField) {
          throw new Error('missing fldStarted');
        }
        startedField.type = FieldType.LongText;
        return 'converted';
      }
    );

    await started.promise;
    expect(duringConversion).toEqual({
      policy: initialPolicy,
      indexes: world.expectedNames({ indexes: [caseOnlyIndex] }),
    });

    const put = world.service.updateQueryIndexPolicy(tableId, {
      indexes: [startedCoalesceIndex],
    });
    await flush();

    expect(world.lockRequests).toHaveLength(2);
    expect(world.lockRequests[1].acquired).toBe(false);
    expect(world.policyWrites).toHaveLength(0);

    const conversionResolves = expect(conversion).resolves.toBe('converted');
    const putRejects = expect(put).rejects.toThrow(
      'Field is not eligible for a coalesce query index: fldStarted'
    );
    mutateFields.resolve(undefined);
    await conversionResolves;
    await putRejects;

    const convertedPolicy: ITableQueryIndexPolicyVo = {
      version: 1,
      indexes: [caseOnlyIndex],
    };
    expect(world.meta.queryIndexPolicy).toEqual(convertedPolicy);
    expect(world.policyWrites).toEqual([{ policy: convertedPolicy, lockHeld: true }]);
    expect(world.indexNames()).toEqual(world.expectedNames(convertedPolicy));
    await expect(world.service.getQueryIndexPolicy(tableId)).resolves.toEqual(convertedPolicy);

    expect(world.dataTransactions).toHaveLength(1);
    expect(world.dataTransactions[0].lockHeld).toBe(true);
    expect(world.dataTransactions[0].indexes).toEqual(world.expectedNames(initialPolicy));
  });
  it('removes dependent indexes when lookup storage changes without a type change', async () => {
    const lookupField: FieldRow = {
      id: 'fldLookup',
      type: FieldType.SingleLineText,
      dbFieldName: 'Lookup',
      isMultipleCellValue: false,
      isLookup: true,
    };
    const lookupIndex: ITableQueryIndexSpec = {
      id: 'lookup_only',
      columns: [{ kind: 'field', fieldId: lookupField.id, direction: 'asc' }],
    };
    const world = createWorld({
      fields: [...fieldSeed, lookupField],
      policy: { version: 1, indexes: [lookupIndex] },
    });

    await expect(
      world.service.withQueryIndexesForFieldConversion(
        tableId,
        lookupField.id,
        FieldType.SingleLineText,
        async () => 'converted',
        { targetIsLookup: false }
      )
    ).resolves.toBe('converted');

    expect(world.meta.queryIndexPolicy).toEqual({ version: 1, indexes: [] });
    expect(world.indexNames()).toEqual([]);
  });

  const unchangedTargetCases: Array<{ label: string; targetType: FieldType | undefined }> = [
    { label: 'an omitted target type', targetType: undefined },
    { label: 'an unchanged target type', targetType: FieldType.Date },
  ];

  it.each(unchangedTargetCases)(
    'keeps every index for $label while still holding the policy lock around the callback',
    async ({ targetType }) => {
      const world = createWorld({ policy: initialPolicy });
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      let duringConversion: string[] | undefined;

      const conversion = world.service.withQueryIndexesForFieldConversion(
        tableId,
        'fldStarted',
        targetType,
        async () => {
          duringConversion = world.indexNames();
          started.resolve(undefined);
          await gate.promise;
          return 'unchanged';
        }
      );

      await started.promise;
      expect(duringConversion).toEqual(world.expectedNames(initialPolicy));

      const put = world.service.updateQueryIndexPolicy(tableId, { indexes: initialPolicy.indexes });
      await flush();

      expect(world.lockRequests).toHaveLength(2);
      expect(world.lockRequests[1].acquired).toBe(false);
      expect(world.dataTransactions).toHaveLength(0);
      expect(world.policyWrites).toHaveLength(0);

      const conversionResolves = expect(conversion).resolves.toBe('unchanged');
      const putResolves = expect(put).resolves.toEqual(initialPolicy);
      gate.resolve(undefined);
      await conversionResolves;
      await putResolves;

      expect(world.meta.queryIndexPolicy).toEqual(initialPolicy);
      expect(world.policyWrites).toEqual([{ policy: initialPolicy, lockHeld: true }]);
      expect(world.indexNames()).toEqual(world.expectedNames(initialPolicy));
      expect(world.dataTransactions).toHaveLength(1);
      expect(world.dataTransactions[0].lockHeld).toBe(true);
      expect(world.dataTransactions[0].indexes).toEqual(world.expectedNames(initialPolicy));
    }
  );
});
