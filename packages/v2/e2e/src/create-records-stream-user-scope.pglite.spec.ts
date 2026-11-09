/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  CreateRecordsStreamCommand,
  type CreateRecordsStreamResult,
  v2CoreTokens,
  type ICommandBus,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  getSharedTestContext,
  TEST_USER,
  type SharedTestContext,
} from './shared/globalTestContext';

const allowedCollaborator = {
  id: 'usrT8238StreamMember',
  name: 'T8238 Stream Member',
  email: 't8238-stream-member@example.invalid',
};
const platformOutsider = {
  id: 'usrT8238StreamOutsider',
  name: 'T8238 Stream Outsider',
  email: 't8238-stream-outsider@example.invalid',
};
const syntheticUserIds = [allowedCollaborator.id, platformOutsider.id];

describe('CreateRecordsStreamCommand user scope (PGlite)', () => {
  let ctx: SharedTestContext;
  let tableId: string | undefined;

  const removeSyntheticAccounts = async () => {
    await ctx.testContainer.db
      .deleteFrom('collaborator')
      .where('principal_id', 'in', syntheticUserIds)
      .execute();
    await ctx.testContainer.db.deleteFrom('users').where('id', 'in', syntheticUserIds).execute();
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
    await removeSyntheticAccounts();
    await ctx.testContainer.db
      .insertInto('users')
      .values([allowedCollaborator, platformOutsider])
      .execute();
    await ctx.testContainer.db
      .insertInto('collaborator')
      .values({
        id: 'colT8238StreamMember',
        resource_type: 'base',
        resource_id: ctx.baseId,
        principal_id: allowedCollaborator.id,
        principal_type: 'user',
      })
      .execute();
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    if (ctx) await removeSyntheticAccounts();
  });

  test('validates complete outsider identities and stores canonical stream records', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8238 Stream User Scope',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    const nameField = table.fields.find((field) => field.name === 'Name');
    const ownerField = table.fields.find((field) => field.name === 'Owner');
    if (!nameField || !ownerField) throw new Error('Missing stream user test fields');

    const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const context = { actorId: ActorId.create(TEST_USER.id)._unsafeUnwrap() };

    const incomplete = await commandBus.execute<
      CreateRecordsStreamCommand,
      CreateRecordsStreamResult
    >(
      context,
      CreateRecordsStreamCommand.create({
        tableId: table.id,
        batchSize: 1,
        records: [
          {
            fields: {
              [nameField.id]: 'incomplete outsider',
              [ownerField.id]: { id: platformOutsider.id },
            },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(incomplete._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.user_not_found',
      message: 'User not found',
    });
    expect(await ctx.listRecordsWithoutDrain(table.id)).toHaveLength(0);

    const mismatched = await commandBus.execute<
      CreateRecordsStreamCommand,
      CreateRecordsStreamResult
    >(
      context,
      CreateRecordsStreamCommand.create({
        tableId: table.id,
        batchSize: 1,
        records: [
          {
            fields: {
              [nameField.id]: 'mismatched outsider',
              [ownerField.id]: {
                id: platformOutsider.id,
                email: 'wrong-stream-outsider@example.invalid',
              },
            },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(mismatched._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.user_not_found',
      message: 'User not found',
    });
    expect(await ctx.listRecordsWithoutDrain(table.id)).toHaveLength(0);

    const outsiderAccepted = await commandBus.execute<
      CreateRecordsStreamCommand,
      CreateRecordsStreamResult
    >(
      context,
      CreateRecordsStreamCommand.create({
        tableId: table.id,
        batchSize: 1,
        records: [
          {
            fields: {
              [nameField.id]: 'canonical outsider',
              [ownerField.id]: { id: platformOutsider.id, email: platformOutsider.email },
            },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(outsiderAccepted._unsafeUnwrap().totalCreated).toBe(1);
    const outsiderRecords = await ctx.listRecordsWithoutDrain(table.id);
    expect(outsiderRecords).toHaveLength(1);
    expect(outsiderRecords[0]?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });

    const collaboratorAccepted = await commandBus.execute<
      CreateRecordsStreamCommand,
      CreateRecordsStreamResult
    >(
      context,
      CreateRecordsStreamCommand.create({
        tableId: table.id,
        batchSize: 1,
        records: [
          {
            fields: {
              [nameField.id]: 'allowed collaborator',
              [ownerField.id]: { id: allowedCollaborator.id },
            },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(collaboratorAccepted._unsafeUnwrap().totalCreated).toBe(1);
    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(2);
    const collaboratorRecord = records.find(
      (record) => record.fields[nameField.id] === 'allowed collaborator'
    );
    expect(collaboratorRecord?.fields[ownerField.id]).toMatchObject({
      id: allowedCollaborator.id,
      title: allowedCollaborator.name,
      email: allowedCollaborator.email,
    });
  });
});
