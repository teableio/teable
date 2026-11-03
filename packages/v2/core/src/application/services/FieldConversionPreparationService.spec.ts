import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { LongTextShowAs } from '../../domain/table/fields/types/LongTextShowAs';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import { MemoryTableRepository } from '../../ports/memory/MemoryTableRepository';
import { FieldConversionPreparationService } from './FieldConversionPreparationService';
import { ForeignTableLoaderService } from './ForeignTableLoaderService';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const buildTable = (suffix = 'p') => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${suffix.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${suffix.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Preview conversion')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder
    .field()
    .longText()
    .withName(FieldName.create('Body')._unsafeUnwrap())
    .withShowAs(LongTextShowAs.create({ type: 'markdown' })._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createService = (table: Table) => {
  const findOne = vi.fn(async () => ok(table));
  const load = vi.fn(async () => ok([]));
  return {
    findOne,
    load,
    service: new FieldConversionPreparationService(
      new Proxy(
        { findOne },
        {
          get(target, property) {
            if (property !== 'findOne')
              throw new Error(`Unexpected persistence access: ${String(property)}`);
            return target.findOne;
          },
        }
      ),
      new DefaultTableMapper(),
      new Proxy(
        { load },
        {
          get(target, property) {
            if (property !== 'load')
              throw new Error(`Unexpected lifecycle access: ${String(property)}`);
            return target.load;
          },
        }
      )
    ),
  };
};

describe('FieldConversionPreparationService', () => {
  it('uses the command update rules and reports a no-op without persistence collaborators', async () => {
    const table = buildTable();
    const field = table.getFields()[1]!;
    const { service, findOne, load } = createService(table);

    const result = await service.prepare(context, {
      tableId: table.id().toString(),
      fieldId: field.id().toString(),
      field: {},
    });

    expect(result._unsafeUnwrap()).toMatchObject({
      isNoop: true,
      isTypeConversion: false,
      requiresDataRewrite: false,
      affectedCellCount: 0,
      linkSideEffectCount: 0,
    });
    expect(findOne).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
  });

  it.each(['options', 'config'] as const)(
    'preserves authorized no-op references in %s without a supplied base id',
    async (referenceKey) => {
      const table = buildTable();
      const foreignTable = buildTable('a');
      const repository = new MemoryTableRepository();
      (await repository.insert(context, table))._unsafeUnwrap();
      (await repository.insert(context, foreignTable))._unsafeUnwrap();
      const service = new FieldConversionPreparationService(
        repository,
        new DefaultTableMapper(),
        new ForeignTableLoaderService(repository)
      );

      const result = await service.prepare(context, {
        tableId: table.id().toString(),
        fieldId: table.getFields()[0]!.id().toString(),
        field: {
          type: 'singleLineText',
          [referenceKey]: { foreignTableId: foreignTable.id().toString() },
        },
      });

      const facts = result._unsafeUnwrap();
      expect(facts).toMatchObject({
        isNoop: true,
        requiresDataRewrite: false,
        affectedCellCount: 0,
      });
      expect(facts.foreignTables.map((foreign) => foreign.id().toString())).toEqual([
        foreignTable.id().toString(),
      ]);
    }
  );

  it('classifies a type conversion and preserves missing aggregation evidence as unknown', async () => {
    const table = buildTable();
    const field = table.getFields()[1]!;
    const { service } = createService(table);
    const aggregationRepository = {
      aggregate: vi.fn(async () => ok([])),
    };

    const result = await service.prepare(
      context,
      {
        tableId: table.id().toString(),
        fieldId: field.id().toString(),
        field: { type: 'singleLineText', updateMode: 'full' },
      },
      { aggregationRepository }
    );

    expect(result._unsafeUnwrap()).toMatchObject({
      isNoop: false,
      isTypeConversion: true,
      requiresDataRewrite: true,
      affectedCellCount: null,
      linkSideEffectCount: 0,
    });
    expect(aggregationRepository.aggregate).toHaveBeenCalledOnce();
    expect(table.getFields()[1]!.type().toString()).toBe('longText');
  });

  it('reports exact filled-cell evidence when the rewrite aggregation returns it', async () => {
    const table = buildTable();
    const field = table.getFields()[1]!;
    const { service } = createService(table);
    const aggregationRepository = {
      aggregate: vi.fn(async () =>
        ok([{ fieldId: field.id(), statisticFunc: 'filled' as const, value: 17 }])
      ),
    };

    const result = await service.prepare(
      context,
      {
        tableId: table.id().toString(),
        fieldId: field.id().toString(),
        field: { type: 'singleLineText', updateMode: 'full' },
      },
      { aggregationRepository }
    );

    expect(result._unsafeUnwrap().affectedCellCount).toBe(17);
  });
});
