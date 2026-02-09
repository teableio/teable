/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateTableCommand,
  RenameTableCommand,
  type CreateTableResult,
  type RenameTableResult,
  TableRenamed,
  v2CoreTokens,
  type ICommandBus,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('RenameTableHandler', () => {
  it('renames tables and publishes TableRenamed', async () => {
    const { container, tableRepository, eventBus, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const createCommandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Original',
      fields: [{ type: 'singleLineText', name: 'Title' }],
    });
    createCommandResult._unsafeUnwrap();

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createCommandResult._unsafeUnwrap()
    );
    createResult._unsafeUnwrap();

    const tableId = createResult._unsafeUnwrap().table.id();
    const renameCommandResult = RenameTableCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      name: 'Renamed',
    });
    renameCommandResult._unsafeUnwrap();

    const renameResult = await commandBus.execute<RenameTableCommand, RenameTableResult>(
      context,
      renameCommandResult._unsafeUnwrap()
    );
    renameResult._unsafeUnwrap();
    const renamedTable = renameResult._unsafeUnwrap().table;

    expect(renamedTable.name().toString()).toBe('Renamed');
    expect(eventBus.events().some((event) => event instanceof TableRenamed)).toBe(true);

    const specResult = renamedTable.specs().byId(renamedTable.id()).build();
    specResult._unsafeUnwrap();

    const savedResult = await tableRepository.findOne(context, specResult._unsafeUnwrap());
    savedResult._unsafeUnwrap();

    expect(savedResult._unsafeUnwrap().name().toString()).toBe('Renamed');
  });
});
