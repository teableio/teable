import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  FieldKeyType,
  FieldName,
  RecordWriteOperationKind,
  Table,
  TableName,
  type RecordWritePluginContext,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTableRowLimitPlugin } from './PostgresTableRowLimitPlugin';

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

describe('PostgresTableRowLimitPlugin', () => {
  it('reads dbTableName from the plugin table context and only queries credit metadata', async () => {
    const executeTakeFirst = vi.fn().mockResolvedValue({ credit: 23 });
    const where = vi.fn().mockReturnValue({ executeTakeFirst });
    const select = vi.fn().mockReturnValue({ where });
    const innerJoin = vi.fn().mockReturnValue({ select });
    const selectFrom = vi.fn().mockReturnValue({ innerJoin });
    const db = { selectFrom } as unknown as Kysely<V1TeableDatabase>;

    const table = buildContextTable();
    const expectedDbTableName = table
      .dbTableName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();
    const context: RecordWritePluginContext = {
      kind: RecordWriteOperationKind.createMany,
      executionContext: {
        actorId: ActorId.create('system')._unsafeUnwrap(),
      },
      table,
      payload: {
        recordsFieldValues: [new Map()],
        fieldKeyType: FieldKeyType.Name,
        typecast: false,
        recordCount: 1,
      },
      isTransactionBound: false,
    };

    const result = await new PostgresTableRowLimitPlugin(db, 10).prepare(context);

    expect(result._unsafeUnwrap()).toEqual({
      dbTableName: expectedDbTableName,
      maxRowCount: 23,
    });
    expect(selectFrom).toHaveBeenCalledWith('base');
    expect(select).toHaveBeenCalledWith(['space.credit as credit']);
    expect(where).toHaveBeenCalledWith('base.id', '=', context.table.baseId().toString());
  });
});
