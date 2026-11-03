import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  DryRunFieldConversionHandler,
  DryRunFieldConversionQuery,
  FieldConversionPreparationService,
  FieldName,
  ForeignTableLoaderService,
  LongTextShowAs,
  MemoryTableRepository,
  Table,
  TableId,
  TableName,
  type TableRecordAggregationField,
  type IExecutionContext,
  type ITableRecordAggregationQueryRepository,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { FieldConvertPreviewPlanner } from './FieldConvertPreviewPlanner';

const context: IExecutionContext = { actorId: ActorId.create('system')._unsafeUnwrap() };
const options = { detail: 'full' as const, includeComplexity: false, maxItems: 100 };

const buildTable = (char: string) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'p'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${char.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Conversion fixture')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder
    .field()
    .longText()
    .withName(FieldName.create('Notes')._unsafeUnwrap())
    .withShowAs(LongTextShowAs.create({ type: 'markdown' })._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const setup = async (table: Table, count: number | null = 7, foreignTable?: Table) => {
  const repository = new MemoryTableRepository();
  await repository.insert(context, table);
  if (foreignTable) await repository.insert(context, foreignTable);
  const mapper = new DefaultTableMapper();
  const loader = new ForeignTableLoaderService(repository);
  const aggregation: Pick<ITableRecordAggregationQueryRepository, 'aggregate'> = {
    aggregate: vi.fn(async (_context, _table, query) =>
      ok(
        count === null
          ? []
          : query.fields.map((field: TableRecordAggregationField) => ({ ...field, value: count }))
      )
    ),
  };
  const writes = [
    vi.spyOn(repository, 'insert'),
    vi.spyOn(repository, 'insertMany'),
    vi.spyOn(repository, 'restore'),
    vi.spyOn(repository, 'setProvisionState'),
    vi.spyOn(repository, 'setProvisionStateMany'),
    vi.spyOn(repository, 'updateOne'),
    vi.spyOn(repository, 'delete'),
  ];
  for (const spy of writes) spy.mockClear();
  const service = new FieldConversionPreparationService(repository, mapper, loader);
  const planner = new FieldConvertPreviewPlanner(service, aggregation);
  const legacy = new DryRunFieldConversionHandler(
    service,
    aggregation as ITableRecordAggregationQueryRepository
  );
  return { planner, legacy, writes, repository };
};

const inputFor = (table: Table, field: Record<string, unknown>) => ({
  tableId: table.id().toString(),
  fieldId: table.getFields()[1]!.id().toString(),
  field,
});

describe('FieldConvertPreviewPlanner', () => {
  it.each([
    { field: {}, code: 'field.conversion.noop', changedFields: 0, rewrite: false },
    {
      field: { type: 'singleLineText', updateMode: 'full' },
      code: 'field.conversion.type_change',
      changedFields: 1,
      rewrite: true,
    },
  ])('preserves legacy classification for $code without metadata/data writes', async (fixture) => {
    const table = buildTable('a');
    const { planner, legacy, writes } = await setup(table);
    const input = inputFor(table, fixture.field);
    const legacyResult = (
      await legacy.handle(context, DryRunFieldConversionQuery.create(input)._unsafeUnwrap())
    )._unsafeUnwrap();
    const plan = (await planner.preview(context, input, options))._unsafeUnwrap();

    expect(plan.effects[0]).toEqual({
      code: fixture.code,
      kind: 'field.conversion',
      measures: {
        changedFields: { basis: 'exact', value: fixture.changedFields, unit: 'fields' },
      },
    });
    expect(legacyResult.isNoop).toBe(fixture.changedFields === 0);
    expect(legacyResult.requiresDataRewrite).toBe(fixture.rewrite);
    if (fixture.rewrite) {
      expect(plan.effects[1]?.measures.affectedCells).toEqual({
        basis: 'exact',
        value: 7,
        unit: 'cells',
      });
      expect(legacyResult.affectedCellCount).toBe(7);
    }
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(plan.coverage.unknown).toContain('fieldOperationPolicies');
  });

  it('counts symmetric link effects using the execution visitors, without writing foreign fields', async () => {
    const table = buildTable('b');
    const foreignTable = buildTable('c');
    const { planner, legacy, writes, repository } = await setup(table, 3, foreignTable);
    const input = inputFor(table, {
      type: 'link',
      updateMode: 'full',
      options: {
        relationship: 'manyOne',
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignTable.primaryFieldId().toString(),
        isOneWay: false,
      },
    });

    const plan = (await planner.preview(context, input, options))._unsafeUnwrap();
    const legacyResult = (
      await legacy.handle(context, DryRunFieldConversionQuery.create(input)._unsafeUnwrap())
    )._unsafeUnwrap();

    expect(plan.effects).toContainEqual({
      code: 'field.conversion.link_side_effects',
      kind: 'dependency.change',
      measures: { changedDependencies: { basis: 'exact', value: 1, unit: 'fields' } },
    });
    expect(legacyResult.linkSideEffectCount).toBe(1);
    expect(
      repository
        .tables()
        .find((item) => item.id().equals(foreignTable.id()))
        ?.getFields()
    ).toHaveLength(2);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it('keeps missing counts unknown and supplies the actual conversion complexity operation', async () => {
    const table = buildTable('d');
    const { planner, writes } = await setup(table, null);
    const plan = (
      await planner.preview(
        context,
        inputFor(table, { type: 'singleLineText', updateMode: 'full' }),
        { ...options, includeComplexity: true }
      )
    )._unsafeUnwrap();

    expect(plan.effects[1]?.measures.affectedCells).toMatchObject({
      basis: 'unknown',
      unit: 'cells',
    });
    expect(plan.coverage.unknown).toEqual(['fieldOperationPolicies', 'affectedCellCount']);
    expect(plan.complexity).toBeNull();
    expect(plan.complexityProjection).toMatchObject({
      tableId: table.id().toString(),
      includeCatalogStats: true,
      operation: {
        kind: 'field-change',
        tableId: table.id().toString(),
        changedFieldIds: [table.getFields()[1]!.id().toString()],
        fieldChange: 'convert',
        dataPresence: 'unknown',
      },
      coverage: {
        unknown: ['complexity-planner-projection', 'complexity-selection'],
      },
    });
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    const serialized = JSON.stringify(plan);
    for (const forbidden of ['mutateSpec', 'updateSpecs', 'dbFieldName', 'SELECT ', 'rowSamples']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
