import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  FieldId,
  FieldKeyType,
  FieldName,
  RecordId,
  RecordWriteOperationKind,
  Table,
  TableName,
  domainError,
  type RecordWritePluginContext,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  PostgresTableRowLimitPlugin,
  SpaceCreditTableRowLimitPolicy,
  StaticTableRowLimitPolicy,
} from './PostgresTableRowLimitPlugin';

const buildContextTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Row Limit')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap().clone(new DefaultTableMapper())._unsafeUnwrap();
};

const createDb = (credit?: number) => {
  const executeTakeFirst = vi.fn().mockResolvedValue(credit == null ? undefined : { credit });
  const query = {
    innerJoin: vi.fn(),
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst,
  };
  query.innerJoin.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  const selectFrom = vi.fn().mockReturnValue(query);
  const db = { selectFrom } as unknown as Kysely<V1TeableDatabase>;

  return {
    db,
    mocks: {
      selectFrom,
      innerJoin: query.innerJoin,
      select: query.select,
      where: query.where,
      executeTakeFirst,
    },
  };
};

const createContext = (
  overrides: Partial<RecordWritePluginContext> = {}
): RecordWritePluginContext =>
  ({
    kind: RecordWriteOperationKind.createMany,
    executionContext: {
      actorId: ActorId.create('system')._unsafeUnwrap(),
    },
    table: buildContextTable(),
    payload: {
      recordsFieldValues: [new Map()],
      fieldKeyType: FieldKeyType.Name,
      typecast: false,
      recordCount: 1,
    },
    isTransactionBound: false,
    ...overrides,
  }) as unknown as RecordWritePluginContext;

describe('PostgresTableRowLimitPlugin', () => {
  it('supports only write operations that may create records', () => {
    const { db } = createDb();
    const plugin = new PostgresTableRowLimitPlugin(db, new StaticTableRowLimitPolicy(10));

    expect(plugin.supports(RecordWriteOperationKind.createOne)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.createMany)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.createStream)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.submit)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.duplicate)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.importAppend)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.paste)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.updateOne)).toBe(false);
    expect(plugin.supports(RecordWriteOperationKind.updateMany)).toBe(false);
    expect(plugin.supports(RecordWriteOperationKind.deleteMany)).toBe(false);
  });

  it('reads dbTableName from the plugin table context and resolves the configured policy', async () => {
    const { db, mocks } = createDb(23);

    const table = buildContextTable();
    const expectedDbTableName = table
      .dbTableName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();
    const context = createContext({ table });

    const result = await new PostgresTableRowLimitPlugin(
      db,
      new StaticTableRowLimitPolicy(23)
    ).prepare(context);

    expect(result._unsafeUnwrap()).toEqual({
      dbTableName: expectedDbTableName,
      maxRowCount: 23,
    });
    expect(mocks.selectFrom).not.toHaveBeenCalled();
  });

  it('uses the configured max row limit from the policy', async () => {
    const { db } = createDb();

    const result = await new PostgresTableRowLimitPlugin(
      db,
      new StaticTableRowLimitPolicy(10)
    ).prepare(createContext());

    expect(result._unsafeUnwrap()).toMatchObject({
      maxRowCount: 10,
    });
  });

  it('resolves legacy space credit before falling back to the static limit', async () => {
    const { db, mocks } = createDb(11);
    const result = await new SpaceCreditTableRowLimitPolicy(db, 10).resolveMaxRowCount(
      createContext()
    );

    expect(result._unsafeUnwrap()).toBe(11);
    expect(mocks.selectFrom).toHaveBeenCalledWith('table_meta');
    expect(mocks.innerJoin).toHaveBeenCalledWith('base', 'base.id', 'table_meta.base_id');
    expect(mocks.innerJoin).toHaveBeenCalledWith('space', 'space.id', 'base.space_id');
  });

  it('uses the static row limit when no legacy space credit is set', async () => {
    const { db } = createDb();
    const result = await new SpaceCreditTableRowLimitPolicy(db, 10).resolveMaxRowCount(
      createContext()
    );

    expect(result._unsafeUnwrap()).toBe(10);
  });

  it('short-circuits prepare when the limit is disabled or the operation does not create rows', async () => {
    const updateContext = createContext({
      kind: RecordWriteOperationKind.updateOne,
      payload: {
        recordId: RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap(),
        fieldValues: new Map(),
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
      },
    });
    const updateResult = await new PostgresTableRowLimitPlugin(
      createDb(23).db,
      new StaticTableRowLimitPolicy(10)
    ).prepare(updateContext);
    expect(updateResult._unsafeUnwrap()).toBeUndefined();
  });

  it('derives create counts for createOne, createStream and paste operations', async () => {
    const plugin = new PostgresTableRowLimitPlugin(
      createDb(11).db,
      new StaticTableRowLimitPolicy(11)
    );

    const createOne = await plugin.prepare(
      createContext({
        kind: RecordWriteOperationKind.createOne,
        payload: {
          fieldValues: new Map(),
          fieldKeyType: FieldKeyType.Name,
          typecast: false,
          source: { type: 'user' },
          recordCount: 1,
        },
      })
    );
    const createStream = await plugin.prepare(
      createContext({
        kind: RecordWriteOperationKind.createStream,
        payload: {
          recordsFieldValues: [new Map(), new Map()],
          batchSize: 2,
          recordCount: 2,
        },
      })
    );
    const paste = await plugin.prepare(
      createContext({
        kind: RecordWriteOperationKind.paste,
        payload: {
          editableFieldIds: [FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap()],
          updateRecordIds: [],
          updateRecordsFieldValues: [],
          createRecordsFieldValues: [new Map(), new Map(), new Map()],
          typecast: false,
          updateRecordCount: 0,
          createRecordCount: 3,
          recordCount: 3,
        },
      })
    );

    expect(createOne._unsafeUnwrap()).toMatchObject({ maxRowCount: 11 });
    expect(createStream._unsafeUnwrap()).toMatchObject({ maxRowCount: 11 });
    expect(paste._unsafeUnwrap()).toMatchObject({ maxRowCount: 11 });
  });

  it('returns an infrastructure error when dbTableName is missing', async () => {
    const { db } = createDb();
    const context = createContext({
      table: {
        baseId: () => BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap(),
        dbTableName: () => err(domainError.validation({ message: 'missing db table name' })),
      } as never,
    });

    const result = await new PostgresTableRowLimitPlugin(
      db,
      new StaticTableRowLimitPolicy(10)
    ).prepare(context);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'infrastructure',
      message: 'Failed to prepare row limit check: table context is missing dbTableName',
    });
  });

  it('returns an infrastructure error when the row limit policy throws', async () => {
    const { db } = createDb();
    const result = await new PostgresTableRowLimitPlugin(db, {
      resolveMaxRowCount: async () => {
        throw new Error('boom');
      },
    }).prepare(createContext());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'infrastructure',
      message: 'Failed to prepare row limit check: boom',
    });
  });

  it('short-circuits guard and beforePersist when there is nothing to enforce', async () => {
    const plugin = new PostgresTableRowLimitPlugin(
      createDb().db,
      new StaticTableRowLimitPolicy(10)
    );
    const updateContext = createContext({
      kind: RecordWriteOperationKind.updateOne,
      payload: {
        recordId: RecordId.create(`rec${'b'.repeat(16)}`)._unsafeUnwrap(),
        fieldValues: new Map(),
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
      },
    });

    await expect(plugin.guard(updateContext, undefined)).resolves.toSatisfy((result) =>
      result.isOk()
    );
    await expect(plugin.beforePersist(updateContext, undefined)).resolves.toSatisfy((result) =>
      result.isOk()
    );
  });
});
