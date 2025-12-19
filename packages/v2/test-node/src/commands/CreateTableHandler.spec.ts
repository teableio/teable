import {
  ActorId,
  CreateTableCommand,
  CreateTableHandler,
  Table,
  TableCreated,
} from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

import { getV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

describe('CreateTableHandler', () => {
  it('returns ok and publishes TableCreated', async () => {
    const { container, tableRepository, eventPublisher, baseId } = getV2NodeTestContainer();
    const handler = container.resolve(CreateTableHandler);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'rating', name: 'Priority', max: 5 },
        { type: 'singleSelect', name: 'Status', options: ['Todo', 'Doing', 'Done'] },
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await handler.handle(context, commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(eventPublisher.events().some((e) => e instanceof TableCreated)).toBe(true);
    expect(result.value.table.primaryFieldId().equals(result.value.table.fields()[0].id())).toBe(
      true
    );
    expect(result.value.table.baseId().equals(baseId)).toBe(true);

    const specResult = Table.specs(baseId).byId(result.value.table.id()).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;
    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isOk()) {
      expect(savedResult.value.primaryFieldId().equals(result.value.table.primaryFieldId())).toBe(
        true
      );
    }
  });

  it('supports non-text primary field', async () => {
    const { container, tableRepository, baseId } = getV2NodeTestContainer();
    const handler = container.resolve(CreateTableHandler);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'rating', name: 'Priority', max: 5, isPrimary: true },
        { type: 'singleSelect', name: 'Status', options: ['Todo', 'Doing', 'Done'] },
      ],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await handler.handle(context, commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.table.primaryFieldId().equals(result.value.table.fields()[1].id())).toBe(
      true
    );

    const specResult = Table.specs(baseId).byId(result.value.table.id()).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;
    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isErr()) return;
    expect(savedResult.value.primaryFieldId().equals(result.value.table.primaryFieldId())).toBe(
      true
    );
  });

  it('supports multiple view types', async () => {
    const { container, tableRepository, baseId } = getV2NodeTestContainer();
    const handler = container.resolve(CreateTableHandler);

    const commandResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Projects',
      fields: [{ type: 'singleLineText', name: 'Name' }],
      views: [{ type: 'kanban' }, { type: 'grid', name: 'All Records' }],
    });

    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const actorIdResult = ActorId.create('system');
    expect(actorIdResult.isOk()).toBe(true);
    if (actorIdResult.isErr()) return;

    const context = { actorId: actorIdResult.value };
    const result = await handler.handle(context, commandResult.value);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value.table.views().map((v) => v.type().toString())).toEqual(['kanban', 'grid']);
    expect(result.value.table.views().map((v) => v.name().toString())).toEqual([
      'Kanban',
      'All Records',
    ]);

    const specResult = Table.specs(baseId).byId(result.value.table.id()).build();
    expect(specResult.isOk()).toBe(true);
    if (specResult.isErr()) return;
    const savedResult = await tableRepository.findOne(context, specResult.value);
    expect(savedResult.isOk()).toBe(true);
    if (savedResult.isErr()) return;
    expect(savedResult.value.views().map((v) => v.type().toString())).toEqual(['kanban', 'grid']);
  });
});
