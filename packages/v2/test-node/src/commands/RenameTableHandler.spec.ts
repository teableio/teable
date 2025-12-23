/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateTableCommand,
  RenameTableCommand,
  type CreateTableResult,
  type RenameTableResult,
  Table,
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
    expect(createCommandResult.isOk()).toBe(true);
    if (createCommandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;
    const context = { actorId: actorIdResult.value };

    const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createCommandResult.value
    );
    expect(createResult.isOk()).toBe(true);
    if (createResult.isErr()) return;

    const tableId = createResult.value.table.id();
    const renameCommandResult = RenameTableCommand.create({
      baseId: baseId.toString(),
      tableId: tableId.toString(),
      name: 'Renamed',
    });
    expect(renameCommandResult.isOk()).toBe(true);
    if (renameCommandResult.isErr()) return;

    const renameResult = await commandBus.execute<RenameTableCommand, RenameTableResult>(
      context,
      renameCommandResult.value
    );
    expect(renameResult.isOk()).toBe(true);
    if (renameResult.isErr()) return;

    expect(renameResult.value.table.name().toString()).toBe('Renamed');
    expect(eventBus.events().some((event) => event instanceof TableRenamed)).toBe(true);

    const specResult = Table.specs(baseId).byId(tableId).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;

    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isErr()) return;
    expect(savedResult.value.name().toString()).toBe('Renamed');
  });
});
