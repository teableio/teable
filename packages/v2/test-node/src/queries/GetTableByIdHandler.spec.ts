/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateTableCommand,
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
import { describe, expect, it, vi } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('GetTableByIdHandler', () => {
  it('returns ok for existing table', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [{ type: 'singleLineText', name: 'Name' }],
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

    const infoSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    try {
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

      expect(infoSpy).toHaveBeenCalledWith(
        'GetTableByIdHandler.start',
        expect.objectContaining({
          actorId: 'system',
          baseId: baseId.toString(),
          tableId: createResult.value.table.id().toString(),
        })
      );
      expect(infoSpy).toHaveBeenCalledWith(
        'GetTableByIdHandler.success',
        expect.objectContaining({
          baseId: baseId.toString(),
          tableId: createResult.value.table.id().toString(),
        })
      );
    } finally {
      infoSpy.mockRestore();
    }
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
