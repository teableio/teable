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
  commandResult._unsafeUnwrap();
  undefined;

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    { actorId },
    commandResult._unsafeUnwrap()
  );
  const resultValue = result._unsafeUnwrap();
  return resultValue.table;
};

describe('ListTablesHandler', () => {
  it('lists tables by base id with default sorting', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const actorId = actorIdResult._unsafeUnwrap();

    const otherBaseIdResult = BaseId.generate();
    otherBaseIdResult._unsafeUnwrap();

    await createTable(commandBus, baseId, 'Gamma', actorId);
    await createTable(commandBus, baseId, 'Alpha', actorId);
    await createTable(commandBus, baseId, 'Beta', actorId);
    await createTable(commandBus, otherBaseIdResult._unsafeUnwrap(), 'Other', actorId);

    const queryResult = ListTablesQuery.create({ baseId: baseId.toString() });
    queryResult._unsafeUnwrap();

    const result = await queryBus.execute<ListTablesQuery, ListTablesResult>(
      { actorId },
      queryResult._unsafeUnwrap()
    );
    const resultValue = result._unsafeUnwrap();

    const names = resultValue.tables.map((table) => table.name().toString());
    expect(names).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(resultValue.tables.every((table) => table.baseId().equals(baseId))).toBe(true);
  });

  it('supports explicit sort and pagination', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const actorId = actorIdResult._unsafeUnwrap();

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
    queryResult._unsafeUnwrap();

    const result = await queryBus.execute<ListTablesQuery, ListTablesResult>(
      { actorId },
      queryResult._unsafeUnwrap()
    );
    const resultValue = result._unsafeUnwrap();
    const names = resultValue.tables.map((table) => table.name().toString());
    expect(names).toEqual(['Beta']);
  });

  it('filters tables by name query', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const actorId = actorIdResult._unsafeUnwrap();

    await createTable(commandBus, baseId, 'Alpha', actorId);
    await createTable(commandBus, baseId, 'Beta', actorId);
    await createTable(commandBus, baseId, 'Gamma', actorId);

    const queryResult = ListTablesQuery.create({
      baseId: baseId.toString(),
      q: 'Al',
    });
    queryResult._unsafeUnwrap();

    const result = await queryBus.execute<ListTablesQuery, ListTablesResult>(
      { actorId },
      queryResult._unsafeUnwrap()
    );
    const resultValue = result._unsafeUnwrap();
    const names = resultValue.tables.map((table) => table.name().toString());
    expect(names).toEqual(['Alpha']);
  });
});
