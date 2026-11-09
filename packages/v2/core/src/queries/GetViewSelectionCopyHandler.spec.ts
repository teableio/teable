import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { NumberFormatting } from '../domain/table/fields/types/NumberFormatting';
import { UserMultiplicity } from '../domain/table/fields/types/UserMultiplicity';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewId } from '../domain/table/views/ViewId';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  ITableRecordAggregationQueryRepository,
  ITableRecordQueryOptions,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import { GetViewSelectionCopyHandler } from './GetViewSelectionCopyHandler';
import { GetViewSelectionCopyQuery } from './GetViewSelectionCopyQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};
const id = (prefix: 'bse' | 'tbl' | 'fld' | 'viw' | 'rec', seed: string) =>
  `${prefix}${seed.repeat(16)}`;
const hash = (value: string) => {
  let result = 5381;
  let index = value.length;
  while (index) result = (result * 33) ^ value.charCodeAt(--index);
  return result >>> 0;
};

const buildSharedTable = (shareMeta: {
  allowCopy?: boolean;
  includeRecords?: boolean;
  includeHiddenField?: boolean;
}) => {
  const tableId = TableId.create(id('tbl', 't'))._unsafeUnwrap();
  const nameFieldId = FieldId.create(id('fld', 'n'))._unsafeUnwrap();
  const amountFieldId = FieldId.create(id('fld', 'a'))._unsafeUnwrap();
  const userFieldId = FieldId.create(id('fld', 'u'))._unsafeUnwrap();
  const reviewersFieldId = FieldId.create(id('fld', 'r'))._unsafeUnwrap();
  const hiddenFieldId = FieldId.create(id('fld', 'h'))._unsafeUnwrap();
  const viewId = ViewId.create(id('viw', 'v'))._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(tableId)
    .withName(TableName.create('Copy')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(nameFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .number()
    .withId(amountFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .withFormatting(NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap())
    .done();
  builder
    .field()
    .user()
    .withId(userFieldId)
    .withName(FieldName.create('Owner')._unsafeUnwrap())
    .done();
  builder
    .field()
    .user()
    .withId(reviewersFieldId)
    .withName(FieldName.create('Reviewers')._unsafeUnwrap())
    .withMultiplicity(UserMultiplicity.multiple())
    .done();
  builder
    .field()
    .singleLineText()
    .withId(hiddenFieldId)
    .withName(FieldName.create('Secret')._unsafeUnwrap())
    .done();
  builder.view().grid().withId(viewId).defaultName().done();
  const table = builder
    .build()
    ._unsafeUnwrap()
    .updateViewColumnMeta(viewId, [
      { fieldId: nameFieldId, columnMeta: { order: 0 } },
      { fieldId: amountFieldId, columnMeta: { order: 1 } },
      { fieldId: userFieldId, columnMeta: { order: 2 } },
      { fieldId: reviewersFieldId, columnMeta: { order: 3 } },
      { fieldId: hiddenFieldId, columnMeta: { order: 4, hidden: true } },
    ])
    ._unsafeUnwrap().updateResult!.table;
  const withMeta = table.updateViewShareMeta(viewId, shareMeta)._unsafeUnwrap().updateResult!.table;
  return {
    table: withMeta.enableViewShare(viewId)._unsafeUnwrap().updateResult.table,
    tableId,
    viewId,
    nameFieldId,
    amountFieldId,
    userFieldId,
    reviewersFieldId,
    hiddenFieldId,
  };
};

const buildRecords = (
  nameFieldId: FieldId,
  amountFieldId: FieldId,
  userFieldId: FieldId,
  reviewersFieldId: FieldId,
  hiddenFieldId: FieldId
): ReadonlyArray<TableRecordReadModel> => {
  const users = [
    {
      id: 'usr-alice',
      title: 'Alice',
      email: 'alice@example.com',
      avatarUrl: 'https://example.com/alice.png',
      role: 'admin',
    },
    { id: 'usr-bob', title: 'Bob', avatarUrl: 'https://example.com/bob.png' },
    null,
  ];
  const reviewers = [
    [users[0], { id: 'usr-carol', title: 'Carol', email: 'carol@example.com', extra: 'private' }],
    [],
    [{ id: 'usr-dan', title: 'Dan' }],
  ];

  return ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
    id: id('rec', String(index + 1)),
    fields: {
      [nameFieldId.toString()]: name,
      [amountFieldId.toString()]: index + 1.234,
      [userFieldId.toString()]: users[index],
      [reviewersFieldId.toString()]: reviewers[index],
      [hiddenFieldId.toString()]: `secret-${index + 1}`,
    },
    version: 1,
  }));
};

const createRecordRepository = (records: ReadonlyArray<TableRecordReadModel>) => {
  const calls: ITableRecordQueryOptions[] = [];
  const specs: unknown[] = [];
  const aggregationCalls: unknown[] = [];
  const repository: ITableRecordAggregationQueryRepository = {
    find: async (_context, _table, spec, options = {}) => {
      calls.push(options);
      specs.push(spec);
      const offset = options.pagination?.offset().toNumber() ?? 0;
      const limit = options.pagination?.limit().toNumber() ?? records.length;
      return ok({ records: records.slice(offset, offset + limit), total: records.length });
    },
    findOne: async () => err(new Error('not used') as never),
    async *findStream() {},
    aggregate: async (_context, _table, aggregation) => {
      aggregationCalls.push(aggregation);
      const fieldId = aggregation.fields[0]!.fieldId;
      return ok(
        records.map((record) => ({
          fieldId,
          statisticFunc: 'count' as const,
          value: 1,
          groupValues: [record.fields[fieldId.toString()]],
        }))
      );
    },
  };
  return { repository, calls, specs, aggregationCalls };
};

const createHandler = async (
  fixture: ReturnType<typeof buildSharedTable>,
  records = buildRecords(
    fixture.nameFieldId,
    fixture.amountFieldId,
    fixture.userFieldId,
    fixture.reviewersFieldId,
    fixture.hiddenFieldId
  )
) => {
  const tables = new MemoryTableRepository();
  await tables.insert(context, fixture.table);
  const recordRepository = createRecordRepository(records);
  return {
    handler: new GetViewSelectionCopyHandler(tables, recordRepository.repository),
    calls: recordRepository.calls,
    specs: recordRepository.specs,
    aggregationCalls: recordRepository.aggregationCalls,
  };
};

describe('GetViewSelectionCopyQuery', () => {
  it('validates identifiers, ranges and max copy cells', () => {
    expect(
      GetViewSelectionCopyQuery.create(
        {
          tableId: 'invalid',
          viewId: 'invalid',
          ranges: [[0, 0]],
        },
        { maxCopyCells: 10 }
      )._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    expect(
      GetViewSelectionCopyQuery.create(
        {
          tableId: fixture.tableId.toString(),
          viewId: fixture.viewId.toString(),
          ranges: [[-1, 0]],
        },
        { maxCopyCells: 10 }
      )._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetViewSelectionCopyHandler', () => {
  it('formats a rectangular selection and uses stored projected record reads', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    const { handler, calls } = await createHandler(fixture);
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        ranges: [
          [0, 0],
          [1, 1],
        ],
      },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();
    const result = (await handler.handle(context, query))._unsafeUnwrap();

    expect(result.content).toBe('Alpha\t1.23\nBeta\t2.23');
    expect(result.fields.map((field) => field.id().toString())).toEqual([
      fixture.nameFieldId.toString(),
      fixture.amountFieldId.toString(),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: 'stored', includeTotal: false });
    expect(calls[0]?.projectionFieldIds?.map((fieldId) => fieldId.toString())).toEqual([
      fixture.nameFieldId.toString(),
      fixture.amountFieldId.toString(),
    ]);
  });

  it('returns original authorized user cells in parallel row order', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    const { handler } = await createHandler(fixture);
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        type: 'rows',
        ranges: [[0, 1]],
        projection: [
          fixture.userFieldId.toString(),
          fixture.reviewersFieldId.toString(),
          fixture.amountFieldId.toString(),
        ],
      },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();

    const result = (await handler.handle(context, query))._unsafeUnwrap();

    expect(result.content).toBe('Alice\tAlice, Carol\t1.23\nBob\t\t2.23');
    expect(result.sourceRecords.map((record) => record.fields[fixture.reviewersFieldId.toString()])).toEqual([
      [
        expect.objectContaining({ id: 'usr-alice', email: 'alice@example.com' }),
        expect.objectContaining({ id: 'usr-carol', email: 'carol@example.com' }),
      ],
      [],
    ]);
  });

  it('excludes hidden projection fields and preserves the copy plan field order', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    const { handler, calls } = await createHandler(fixture);
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        type: 'rows',
        ranges: [[0, 0]],
        projection: [
          fixture.hiddenFieldId.toString(),
          fixture.amountFieldId.toString(),
          fixture.userFieldId.toString(),
          fixture.nameFieldId.toString(),
        ],
      },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();

    const result = (await handler.handle(context, query))._unsafeUnwrap();

    expect(result.fields.map((field) => field.id().toString())).toEqual([
      fixture.amountFieldId.toString(),
      fixture.userFieldId.toString(),
      fixture.nameFieldId.toString(),
    ]);
    expect(result.content).toBe('1.23\tAlice\tAlpha');
    expect(result.sourceRecords[0]?.fields[fixture.userFieldId.toString()]).toEqual(
      expect.objectContaining({ id: 'usr-alice', email: 'alice@example.com' })
    );
    expect(calls[0]?.projectionFieldIds?.map((fieldId) => fieldId.toString())).toEqual([
      fixture.amountFieldId.toString(),
      fixture.userFieldId.toString(),
      fixture.nameFieldId.toString(),
    ]);
  });

  it('preserves disjoint and overlapping row windows in request order', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    const { handler, calls } = await createHandler(fixture);
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        type: 'rows',
        ranges: [
          [1, 2],
          [0, 1],
        ],
        projection: [fixture.nameFieldId.toString()],
      },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();

    const result = (await handler.handle(context, query))._unsafeUnwrap();
    expect(result.content).toBe('Beta\nGamma\nAlpha\nBeta');
    expect(calls.map((call) => call.pagination?.offset().toNumber())).toEqual([1, 0]);
  });

  it('uses the total row count to reject oversized column selections', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    const { handler, calls } = await createHandler(fixture);
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        type: 'columns',
        ranges: [[0, 1]],
      },
      { maxCopyCells: 5 }
    )._unsafeUnwrap();
    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'view_selection_copy.exceed_max_copy_cells',
      tags: ['validation'],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: 'stored', includeTotal: true });
  });

  it('enforces copy permission before reading or exposing raw cells', async () => {
    const fixture = buildSharedTable({ allowCopy: false, includeRecords: true });
    const { handler, calls } = await createHandler(fixture);
    const input = {
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      ranges: [
        [0, 0],
        [0, 0],
      ],
    };
    const denied = GetViewSelectionCopyQuery.create(input, { maxCopyCells: 10 })._unsafeUnwrap();

    expect((await handler.handle(context, denied))._unsafeUnwrapErr()).toMatchObject({
      code: 'view_selection_copy.not_allowed',
      tags: ['forbidden'],
    });
    expect(calls).toHaveLength(0);

    const editor = GetViewSelectionCopyQuery.create(
      { ...input, canCopyAsEditor: true },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();
    (await handler.handle(context, editor))._unsafeUnwrap();
    expect(calls).toHaveLength(1);
  });

  it('does not query records when the share excludes them', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: false });
    const { handler, calls } = await createHandler(fixture);
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        ranges: [
          [0, 0],
          [0, 1],
        ],
      },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();
    const result = (await handler.handle(context, query))._unsafeUnwrap();

    expect(result.content).toBe('');
    expect(result.fields).toHaveLength(1);
    expect(result.sourceRecords).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it.each([false, true])(
    'matches shared-grid persisted sort/group defaults for absent or empty overrides (empty=%s)',
    async (empty) => {
      const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
      fixture.table = fixture.table
        .updateViewSort(fixture.viewId, {
          sortObjs: [{ fieldId: fixture.amountFieldId.toString(), order: 'desc' }],
        })
        ._unsafeUnwrap()
        .updateResult!.table.updateViewGroup(fixture.viewId, [
          { fieldId: fixture.nameFieldId.toString(), order: 'asc' },
        ])
        ._unsafeUnwrap().updateResult!.table;
      const { handler, calls, aggregationCalls } = await createHandler(fixture);
      const query = GetViewSelectionCopyQuery.create(
        {
          tableId: fixture.tableId.toString(),
          viewId: fixture.viewId.toString(),
          type: 'rows',
          ranges: [[0, 0]],
          projection: [fixture.nameFieldId.toString()],
          orderBy: empty ? [] : undefined,
          groupBy: empty ? [] : undefined,
          collapsedGroupIds: [String(hash(`${fixture.nameFieldId.toString()}_Alpha`))],
        },
        { maxCopyCells: 10 }
      )._unsafeUnwrap();

      (await handler.handle(context, query))._unsafeUnwrap();

      expect(aggregationCalls).toHaveLength(1);
      expect(calls[0]?.orderBy).toEqual([
        {
          fieldId: fixture.nameFieldId,
          direction: 'asc',
          groupIdentityCollation: true,
        },
        { fieldId: fixture.amountFieldId, direction: 'desc' },
        { column: `__row_${fixture.viewId.toString()}`, direction: 'asc' },
        { column: '__auto_number', direction: 'asc' },
      ]);
    }
  );

  it('uses the existing Table Record aggregation capability for collapsed groups', async () => {
    const fixture = buildSharedTable({ allowCopy: true, includeRecords: true });
    const { handler, specs, aggregationCalls } = await createHandler(fixture);
    const alphaGroupId = String(hash(`${fixture.nameFieldId.toString()}_Alpha`));
    const query = GetViewSelectionCopyQuery.create(
      {
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        type: 'rows',
        ranges: [[0, 0]],
        projection: [fixture.nameFieldId.toString()],
        groupBy: [{ fieldId: fixture.nameFieldId.toString(), order: 'asc' }],
        collapsedGroupIds: [alphaGroupId],
      },
      { maxCopyCells: 10 }
    )._unsafeUnwrap();

    const result = await handler.handle(context, query);
    expect(result.isOk(), result.isErr() ? JSON.stringify(result.error) : undefined).toBe(true);

    expect(aggregationCalls).toHaveLength(1);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toBeDefined();
  });
});
