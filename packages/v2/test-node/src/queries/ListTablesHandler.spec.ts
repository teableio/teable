/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  BaseId,
  CreateTableCommand,
  ListTablesQuery,
  v2CoreTokens,
} from '@teable/v2-core';
import type { CreateTableResult, ICommandBus, IQueryBus, ListTablesResult } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const createTable = async (
  commandBus: ICommandBus,
  baseId: BaseId,
  name: string,
  actorId: ActorId
) => {
  const commandResult = CreateTableCommand.create({
    baseId: baseId.toString(),
    name,
    fields: [{ type: 'singleLineText', name: 'Name' }],
  });
  expect(commandResult.isOk()).toBe(true);
  if (commandResult.isErr()) return undefined;

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    { actorId },
    commandResult.value
  );
  expect(result.isOk()).toBe(true);
  if (result.isErr()) return undefined;
  return result.value.table;
};

describe('ListTablesHandler', () => {
  it('lists tables by base id with default sorting', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const actorId = actorIdResult.value;

    const otherBaseIdResult = BaseId.generate();
    expect(otherBaseIdResult.isOk()).toBe(true);
    if (otherBaseIdResult.isErr()) return;

    await createTable(commandBus, baseId, 'Gamma', actorId);
    await createTable(commandBus, baseId, 'Alpha', actorId);
    await createTable(commandBus, baseId, 'Beta', actorId);
    await createTable(commandBus, otherBaseIdResult.value, 'Other', actorId);

    const queryResult = ListTablesQuery.create({ baseId: baseId.toString() });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const result = await queryBus.execute<ListTablesQuery, ListTablesResult>(
      { actorId },
      queryResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const names = result.value.tables.map((table) => table.name().toString());
    expect(names).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(result.value.tables.every((table) => table.baseId().equals(baseId))).toBe(true);
  });

  it('supports explicit sort and pagination', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const actorId = actorIdResult.value;

    await createTable(commandBus, baseId, 'Alpha', actorId);
    await createTable(commandBus, baseId, 'Beta', actorId);
    await createTable(commandBus, baseId, 'Gamma', actorId);

    const queryResult = ListTablesQuery.create({
      baseId: baseId.toString(),
      sortBy: 'name',
      sortDirection: 'desc',
      limit: 1,
      offset: 1,
    });
    expect(queryResult.isOk()).toBe(true);
    if (queryResult.isErr()) return;

    const result = await queryBus.execute<ListTablesQuery, ListTablesResult>(
      { actorId },
      queryResult.value
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    const names = result.value.tables.map((table) => table.name().toString());
    expect(names).toEqual(['Beta']);
  });
});
