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

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      commandResult.value
    );
    expect(createResult.isOk()).toBe(true);
    if (createResult.isErr()) return;

    const queryResult = GetTableByIdQuery.create({
      baseId: baseId.toString(),
      tableId: createResult.value.table.id().toString(),
    });

    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      context,
      queryResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.table.id().equals(createResult.value.table.id())).toBe(true);
    expect(result.value.table.baseId().equals(baseId)).toBe(true);

    const table = result.value.table;
    const byId = new Map(table.fields().map((field) => [field.id().toString(), field]));
    const scoreField = byId.get(scoreId);
    const scoreLabelField = byId.get(scoreLabelId);
    expect(scoreField).toBeTruthy();
    expect(scoreLabelField).toBeTruthy();
    if (!scoreField || !scoreLabelField) return;

    const valueTypeVisitor = new FieldValueTypeVisitor();
    const scoreType = scoreField.accept(valueTypeVisitor);
    expect(scoreType.isOk()).toBe(true);
    if (scoreType.isErr()) return;
    expect(scoreType.value.cellValueType.toString()).toBe('number');

    const scoreLabelType = scoreLabelField.accept(valueTypeVisitor);
    expect(scoreLabelType.isOk()).toBe(true);
    if (scoreLabelType.isErr()) return;
    expect(scoreLabelType.value.cellValueType.toString()).toBe('string');
  });

  it('returns err when table is missing', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const tableIdResult = TableId.generate();
    expect(tableIdResult.isOk()).toBe(true);
    if (tableIdResult.isErr()) return;

    const queryResult = GetTableByIdQuery.create({
      baseId: baseId.toString(),
      tableId: tableIdResult.value.toString(),
    });

    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
      { actorId: actorIdResult.value },
      queryResult.value
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('Table not found');
    }
  });
});
