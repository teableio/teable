/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  type ICommandBus,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RedoCommand,
  UndoCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('paste canonical member events and history (PGlite)', () => {
  let ctx: SharedTestContext;
  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
  });

  test.each([
    { count: 1, existing: 1, typecast: true },
    { count: 2, existing: 2, typecast: true },
    { count: 2, existing: 2, typecast: false },
    { count: 2, existing: 1, typecast: true },
  ])('canonicalizes paste events and redo snapshots: %j', async ({ count, existing, typecast }) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Canonical member paste history',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      views: [{ type: 'grid' }],
    });
    try {
      const nameId = table.fields[0]!.id;
      const ownerIndex = table.fields.findIndex((field) => field.name === 'Owner');
      const ownerId = table.fields[ownerIndex]!.id;
      for (let index = 0; index < existing; index++) {
        await ctx.createRecord(table.id, { [nameId]: `Row ${index}` });
      }
      const beforeEvents = ctx.testContainer.eventBus.events().length;
      await ctx.paste({
        tableId: table.id,
        viewId: table.views[0]!.id,
        ranges: [
          [ownerIndex, 0],
          [ownerIndex, count - 1],
        ],
        content: Array.from({ length: count }, () => [
          {
            id: ctx.testUser.id,
            title: 'Forged member title',
            email: ctx.testUser.email,
          },
        ]),
        typecast,
      });
      const canonical = {
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
      };
      const changes = ctx.testContainer.eventBus
        .events()
        .slice(beforeEvents)
        .filter(
          (event): event is RecordsBatchUpdated =>
            event instanceof RecordsBatchUpdated && event.tableId.toString() === table.id
        )
        .flatMap((event) => event.updates)
        .flatMap((update) => update.changes)
        .filter((change) => change.fieldId === ownerId);
      expect(changes).toHaveLength(existing);
      for (const change of changes) expect(change.newValue).toMatchObject(canonical);
      const created = ctx.testContainer.eventBus
        .events()
        .slice(beforeEvents)
        .filter(
          (event): event is RecordsBatchCreated =>
            event instanceof RecordsBatchCreated && event.tableId.toString() === table.id
        )
        .flatMap((event) => event.records);
      expect(created).toHaveLength(count - existing);
      for (const record of created) {
        expect(record.fields.find((field) => field.fieldId === ownerId)?.value).toMatchObject(
          canonical
        );
      }
      const pasted = await ctx.listRecordsWithoutDrain(table.id);
      expect(pasted).toHaveLength(count);
      for (const record of pasted) expect(record.fields[ownerId]).toMatchObject(canonical);

      const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = {
        actorId: ActorId.create(ctx.testUser.id)._unsafeUnwrap(),
        windowId: 'e2e-window',
      };
      (
        await commandBus.execute(
          context,
          UndoCommand.create({ tableId: table.id, windowId: context.windowId })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const undone = await ctx.listRecordsWithoutDrain(table.id);
      expect(undone).toHaveLength(existing);
      for (const record of undone) {
        expect(record.fields[ownerId] ?? null).toBeNull();
      }
      (
        await commandBus.execute(
          context,
          RedoCommand.create({ tableId: table.id, windowId: context.windowId })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const redone = await ctx.listRecordsWithoutDrain(table.id);
      expect(redone).toHaveLength(count);
      for (const record of redone) {
        expect(record.fields[ownerId]).toMatchObject(canonical);
      }
    } finally {
      await ctx.deleteTable(table.id);
    }
  });
});
