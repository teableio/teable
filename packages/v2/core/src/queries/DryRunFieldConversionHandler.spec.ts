import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import { LongTextShowAs } from '../domain/table/fields/types/LongTextShowAs';
import { RatingMax } from '../domain/table/fields/types/RatingMax';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { DefaultTableMapper } from '../ports/mappers/defaults/DefaultTableMapper';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  ITableRecordAggregationQueryRepository,
  TableRecordAggregationValue,
} from '../ports/TableRecordQueryRepository';
import { DryRunFieldConversionHandler } from './DryRunFieldConversionHandler';
import { DryRunFieldConversionQuery } from './DryRunFieldConversionQuery';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTableWithLongTextField = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create('Issues')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder
    .field()
    .longText()
    .withName(FieldName.create('Reply')._unsafeUnwrap())
    .withShowAs(LongTextShowAs.create({ type: 'markdown' })._unsafeUnwrap())
    .done();
  builder
    .field()
    .rating()
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .withMax(RatingMax.create(10)._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const aggregationRepoWithFilledCount = (
  filledCount: number
): ITableRecordAggregationQueryRepository => {
  // Only `aggregate` is exercised by the handler; the rest of the interface is
  // irrelevant here, hence the partial object.
  const partial: Pick<ITableRecordAggregationQueryRepository, 'aggregate'> = {
    aggregate: async (_context: IExecutionContext, _table: Table, aggregation) => {
      const values: TableRecordAggregationValue[] = aggregation.fields.map((field) => ({
        fieldId: field.fieldId,
        statisticFunc: field.statisticFunc,
        value: filledCount,
      }));
      return ok(values) as Result<ReadonlyArray<TableRecordAggregationValue>, DomainError>;
    },
  };
  return partial as ITableRecordAggregationQueryRepository;
};

const createHandler = (filledCount: number, repo: MemoryTableRepository) =>
  new DryRunFieldConversionHandler(
    repo,
    new DefaultTableMapper(),
    new ForeignTableLoaderService(repo),
    aggregationRepoWithFilledCount(filledCount)
  );

const dryRun = async (
  table: Table,
  repo: MemoryTableRepository,
  fieldUpdate: Record<string, unknown>,
  options?: { filledCount?: number; fieldIndex?: number }
) => {
  const context = createContext();
  await repo.insert(context, table);
  const field = table.getFields()[options?.fieldIndex ?? 1];
  const query = DryRunFieldConversionQuery.create({
    tableId: table.id().toString(),
    fieldId: field.id().toString(),
    field: fieldUpdate,
  })._unsafeUnwrap();
  const result = await createHandler(options?.filledCount ?? 0, repo).handle(context, query);
  return result._unsafeUnwrap();
};

describe('DryRunFieldConversionHandler', () => {
  it('reports noop when nothing changes', async () => {
    const table = buildTableWithLongTextField();
    const repo = new MemoryTableRepository();

    const result = await dryRun(table, repo, {});

    expect(result.isNoop).toBe(true);
    expect(result.requiresDataRewrite).toBe(false);
    expect(result.affectedCellCount).toBe(0);
  });

  it('reports aiConfig-only changes as non-data-affecting', async () => {
    const table = buildTableWithLongTextField();
    const repo = new MemoryTableRepository();

    const result = await dryRun(
      table,
      repo,
      {
        aiConfig: { type: 'customization', modelKey: 'model-a', prompt: 'Say hi' },
        updateMode: 'full',
      },
      { filledCount: 42 }
    );

    expect(result.isNoop).toBe(false);
    expect(result.isTypeConversion).toBe(false);
    expect(result.requiresDataRewrite).toBe(false);
    expect(result.affectedCellCount).toBe(0);
    expect(result.linkSideEffectCount).toBe(0);
  });

  it('reports showAs display changes as non-data-affecting', async () => {
    const table = buildTableWithLongTextField();
    const repo = new MemoryTableRepository();

    const result = await dryRun(
      table,
      repo,
      { options: {}, updateMode: 'full' },
      { filledCount: 42 }
    );

    expect(result.requiresDataRewrite).toBe(false);
    expect(result.affectedCellCount).toBe(0);
  });

  it('counts filled cells for a type conversion', async () => {
    const table = buildTableWithLongTextField();
    const repo = new MemoryTableRepository();

    const result = await dryRun(
      table,
      repo,
      { type: 'singleLineText', updateMode: 'full' },
      { filledCount: 7 }
    );

    expect(result.isTypeConversion).toBe(true);
    expect(result.requiresDataRewrite).toBe(true);
    expect(result.affectedCellCount).toBe(7);
  });

  it('treats reducing a rating max as data-affecting (clamps stored cells)', async () => {
    const table = buildTableWithLongTextField();
    const repo = new MemoryTableRepository();

    const result = await dryRun(table, repo, { max: 3 }, { fieldIndex: 2, filledCount: 5 });

    expect(result.requiresDataRewrite).toBe(true);
    expect(result.affectedCellCount).toBe(5);
  });

  it('treats raising a rating max as non-data-affecting', async () => {
    const repo = new MemoryTableRepository();

    // The shared builder's rating field is already max 10, so build a max-5
    // field and raise it to 10 here.
    const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
    const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(baseId)
      .withId(tableId)
      .withName(TableName.create('Ratings')._unsafeUnwrap());
    builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
    builder
      .field()
      .rating()
      .withName(FieldName.create('Score')._unsafeUnwrap())
      .withMax(RatingMax.create(5)._unsafeUnwrap())
      .done();
    builder.view().defaultGrid().done();
    const maxFiveTable = builder.build()._unsafeUnwrap();

    const result = await dryRun(maxFiveTable, repo, { max: 10 }, { fieldIndex: 1 });

    expect(result.requiresDataRewrite).toBe(false);
    expect(result.affectedCellCount).toBe(0);
  });
});
