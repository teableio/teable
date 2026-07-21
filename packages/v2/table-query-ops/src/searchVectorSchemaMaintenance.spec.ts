import {
  BaseId,
  domainError,
  FieldCreated,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  ViewName,
  ok,
} from '@teable/v2-core';
import { err } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { TableSearchVectorSchemaMaintenanceProjection } from './searchVectorSchemaMaintenance';

const makeTable = () => {
  const builder = Table.builder()
    .withId(TableId.create('tbl0000000000000001')._unsafeUnwrap())
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create('Orders')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create('fld0000000000000001')._unsafeUnwrap())
    .withName(FieldName.create('Order')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().grid().withName(ViewName.create('Grid')._unsafeUnwrap()).done();
  return builder.build()._unsafeUnwrap();
};

describe('TableSearchVectorSchemaMaintenanceProjection', () => {
  it('loads the latest table aggregate and schedules schema maintenance', async () => {
    const table = makeTable();
    const context = {} as never;
    const repository = { findOne: vi.fn().mockResolvedValue(ok(table)) };
    const scheduler = {
      schedule: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const logger = { warn: vi.fn() };
    const projection = new TableSearchVectorSchemaMaintenanceProjection(
      repository as never,
      scheduler as never,
      logger as never
    );
    const event = FieldCreated.create({
      tableId: table.id(),
      baseId: table.baseId(),
      fieldId: table.primaryFieldId(),
    });

    const result = await projection.handle(context, event);

    expect(result.isOk()).toBe(true);
    expect(repository.findOne).toHaveBeenCalledOnce();
    expect(scheduler.schedule).toHaveBeenCalledWith(context, {
      table,
      reason: 'field_created',
    });
  });

  it('does not fail the field command when background scheduling fails', async () => {
    const table = makeTable();
    const context = {} as never;
    const repository = { findOne: vi.fn().mockResolvedValue(ok(table)) };
    const scheduler = {
      schedule: vi
        .fn()
        .mockResolvedValue(err(domainError.infrastructure({ message: 'queue unavailable' }))),
    };
    const logger = { warn: vi.fn() };
    const projection = new TableSearchVectorSchemaMaintenanceProjection(
      repository as never,
      scheduler as never,
      logger as never
    );

    const result = await projection.handle(
      context,
      FieldCreated.create({
        tableId: table.id(),
        baseId: table.baseId(),
        fieldId: table.primaryFieldId(),
      })
    );

    expect(result.isOk()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to schedule search vector maintenance after field schema change',
      expect.objectContaining({ tableId: table.id().toString(), error: 'queue unavailable' })
    );
  });
});
