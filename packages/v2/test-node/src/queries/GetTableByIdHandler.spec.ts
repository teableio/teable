/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateTableCommand,
  FieldValueTypeVisitor,
  GetTableByIdQuery,
  TableId,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  CreateTableResult,
  GetTableByIdResult,
  ICommandBus,
  IQueryBus,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('GetTableByIdHandler', () => {
  it('returns ok for existing table', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const amountId = `fld${'a'.repeat(16)}`;
    const scoreId = `fld${'b'.repeat(16)}`;
    const scoreLabelId = `fld${'c'.repeat(16)}`;
    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'number', id: amountId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreId,
          name: 'Score',
          options: { expression: `{${amountId}} * 2` },
        },
        {
          type: 'formula',
          id: scoreLabelId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${scoreId}})` },
        },
      ],
    });

    commandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };
    const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult._unsafeUnwrap()
    );
    createResult._unsafeUnwrap();

    const queryResult = GetTableByIdQuery.create({
      baseId: baseId.toString(),
      tableId: createResult._unsafeUnwrap().table.id().toString(),
    });

    queryResult._unsafeUnwrap();

    const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      context,
      queryResult._unsafeUnwrap()
    );
    const resultValue = result._unsafeUnwrap();

    expect(resultValue.table.id().equals(createResult._unsafeUnwrap().table.id())).toBe(true);
    expect(resultValue.table.baseId().equals(baseId)).toBe(true);

    const table = resultValue.table;
    const byId = new Map(table.getFields().map((field) => [field.id().toString(), field]));
    const scoreField = byId.get(scoreId);
    const scoreLabelField = byId.get(scoreLabelId);
    expect(scoreField).toBeTruthy();
    expect(scoreLabelField).toBeTruthy();
    if (!scoreField || !scoreLabelField) return;

    const valueTypeVisitor = new FieldValueTypeVisitor();
    const scoreType = scoreField.accept(valueTypeVisitor);
    const scoreTypeValue = scoreType._unsafeUnwrap();
    expect(scoreTypeValue.cellValueType.toString()).toBe('number');

    const scoreLabelType = scoreLabelField.accept(valueTypeVisitor);
    const scoreLabelTypeValue = scoreLabelType._unsafeUnwrap();
    expect(scoreLabelTypeValue.cellValueType.toString()).toBe('string');
  });

  it('returns err when table is missing', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const tableIdResult = TableId.generate();
    tableIdResult._unsafeUnwrap();

    const queryResult = GetTableByIdQuery.create({
      baseId: baseId.toString(),
      tableId: tableIdResult._unsafeUnwrap().toString(),
    });

    queryResult._unsafeUnwrap();

    const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      { actorId: actorIdResult._unsafeUnwrap() },
      queryResult._unsafeUnwrap()
    );

    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });
});
