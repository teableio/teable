/* eslint-disable @typescript-eslint/naming-convention */
import { ActorId, type ICommandBus, UpsertRecordsCommand, v2CoreTokens } from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
import {
  ensureAttachmentTables,
  makeAttachmentCell,
  seedAttachment,
  type SeededAttachment,
} from './update-field/attachment/testUtils';

const baseMember = {
  id: 'usrT8238BaseMember',
  name: 'T8238 Base Member',
  email: 't8238-base-member@example.invalid',
};
const spaceMember = {
  id: 'usrT8238SpaceMember',
  name: 'T8238 Space Member',
  email: 't8238-space-member@example.invalid',
};
const platformOutsider = {
  id: 'usrT8238PlatformOutsider',
  name: 'T8238 Platform Outsider',
  email: 't8238-platform-outsider@example.invalid',
};
const numericNameOutsider = {
  id: 'usrT8238NumericNameOutsider',
  name: '5',
  email: 't8238-numeric-name-outsider@example.invalid',
};
const dateNameOutsider = {
  id: 'usrT8238DateNameOutsider',
  name: '2024-01-15T10:30:00.000Z',
  email: 't8238-date-name-outsider@example.invalid',
};
const booleanNameOutsider = {
  id: 'usrT8238BooleanNameOutsider',
  name: 'true',
  email: 't8238-boolean-name-outsider@example.invalid',
};
const syntheticUsers = [
  baseMember,
  spaceMember,
  platformOutsider,
  numericNameOutsider,
  dateNameOutsider,
  booleanNameOutsider,
];
const syntheticUserIds = syntheticUsers.map(({ id }) => id);

type HttpResult = { status: number; body: unknown };

describe('v2 HTTP member write permission boundary (PGlite)', () => {
  let ctx: SharedTestContext;
  let spaceId: string;
  let attachmentSeed: SeededAttachment;
  const tableIds: string[] = [];

  const post = async (path: string, body: unknown): Promise<HttpResult> => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const removeSyntheticAccounts = async () => {
    await ctx.testContainer.db
      .deleteFrom('collaborator')
      .where('principal_id', 'in', syntheticUserIds)
      .execute();
    await ctx.testContainer.db.deleteFrom('users').where('id', 'in', syntheticUserIds).execute();
  };

  const createUserTable = async (name: string) => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name,
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false } },
        { type: 'user', name: 'Members', options: { isMultiple: true } },
      ],
      views: [{ type: 'grid' }],
    });
    tableIds.push(table.id);
    const nameField = table.fields.find((field) => field.name === 'Name');
    const ownerField = table.fields.find((field) => field.name === 'Owner');
    const membersField = table.fields.find((field) => field.name === 'Members');
    if (!nameField || !ownerField || !membersField) throw new Error('Missing member test fields');
    return { table, nameField, ownerField, membersField };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
    await removeSyntheticAccounts();
    const base = await ctx.testContainer.db
      .selectFrom('base')
      .select('space_id')
      .where('id', '=', ctx.baseId)
      .executeTakeFirstOrThrow();
    spaceId = base.space_id;

    await ensureAttachmentTables(ctx);
    attachmentSeed = await seedAttachment(ctx);
    await ctx.testContainer.db.insertInto('users').values(syntheticUsers).execute();
    await ctx.testContainer.db
      .insertInto('collaborator')
      .values([
        {
          id: 'colT8238BaseMember',
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: baseMember.id,
          principal_type: 'user',
        },
        {
          id: 'colT8238SpaceMember',
          resource_type: 'space',
          resource_id: spaceId,
          principal_id: spaceMember.id,
          principal_type: 'user',
        },
      ])
      .execute();
  });

  afterAll(async () => {
    for (const tableId of tableIds) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
    if (ctx) await removeSyntheticAccounts();
  });

  test('strict record HTTP accepts base and space members but rejects a platform outsider', async () => {
    const { table, nameField, ownerField, membersField } = await createUserTable(
      'T8238 Strict Member Scope'
    );

    const accepted = await post('/tables/createRecords', {
      tableId: table.id,
      records: [
        {
          fields: {
            [nameField.id]: 'allowed members',
            [ownerField.id]: { id: baseMember.id },
            [membersField.id]: [{ id: baseMember.id }, { id: spaceMember.id }],
          },
        },
      ],
      typecast: false,
    });
    expect(accepted.status).toBe(201);

    const rejected = await post('/tables/createRecords', {
      tableId: table.id,
      records: [
        {
          fields: {
            [nameField.id]: 'mixed unauthorized members',
            [membersField.id]: [{ id: baseMember.id }, { id: platformOutsider.id }],
          },
        },
      ],
      typecast: false,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: {
        code: 'validation.field.user_not_found',
        message: 'User not found',
      },
    });

    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerField.id]).toMatchObject({
      id: baseMember.id,
      title: baseMember.name,
      email: baseMember.email,
    });
    expect(records[0]?.fields[membersField.id]).toEqual([
      expect.objectContaining({
        id: baseMember.id,
        title: baseMember.name,
        email: baseMember.email,
      }),
      expect.objectContaining({
        id: spaceMember.id,
        title: spaceMember.name,
        email: spaceMember.email,
      }),
    ]);
  });

  test('strict update rejects an outsider without replacing the existing member', async () => {
    const { table, nameField, ownerField } = await createUserTable('T8238 Strict Update Scope');
    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'protected owner',
      [ownerField.id]: { id: baseMember.id },
    });

    const rejected = await post('/tables/updateRecord', {
      tableId: table.id,
      recordId: record.id,
      fields: { [ownerField.id]: { id: platformOutsider.id } },
      typecast: false,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: { code: 'validation.field.user_not_found' },
    });

    const [stored] = await ctx.listRecordsWithoutDrain(table.id);
    expect(stored?.fields[ownerField.id]).toMatchObject({
      id: baseMember.id,
      title: baseMember.name,
      email: baseMember.email,
    });
  });

  test('strict and typecast record HTTP enforce complete canonical outsider identities', async () => {
    const { table, nameField, ownerField, membersField } = await createUserTable(
      'T8238 Structured Identity Scope'
    );

    for (const typecast of [false, true]) {
      const accepted = await post('/tables/createRecords', {
        tableId: table.id,
        records: [
          {
            fields: {
              [nameField.id]: `canonical structured outsider ${typecast}`,
              [ownerField.id]: { id: platformOutsider.id, email: platformOutsider.email },
              [membersField.id]: [
                { id: platformOutsider.id, email: platformOutsider.email },
                { id: baseMember.id },
              ],
            },
          },
        ],
        typecast,
      });
      expect(accepted.status).toBe(201);

      for (const rejectedFields of [
        {
          [ownerField.id]: {
            id: platformOutsider.id,
            email: 'wrong-outsider-email@example.invalid',
          },
        },
        {
          [membersField.id]: [
            { id: platformOutsider.id, email: platformOutsider.email },
            { id: baseMember.id, email: 'wrong-collaborator-email@example.invalid' },
          ],
        },
        { [ownerField.id]: { id: platformOutsider.id } },
      ]) {
        const rejected = await post('/tables/createRecords', {
          tableId: table.id,
          records: [
            {
              fields: {
                [nameField.id]: `rejected structured identity ${typecast}`,
                ...rejectedFields,
              },
            },
          ],
          typecast,
        });
        expect(rejected.status).toBe(400);
        expect(rejected.body).toMatchObject({
          ok: false,
          error: { code: 'validation.field.user_not_found' },
        });
      }
    }

    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.fields[ownerField.id]).toMatchObject({
        id: platformOutsider.id,
        title: platformOutsider.name,
        email: platformOutsider.email,
      });
      expect(record.fields[membersField.id]).toEqual([
        expect.objectContaining({
          id: platformOutsider.id,
          title: platformOutsider.name,
          email: platformOutsider.email,
        }),
        expect.objectContaining({
          id: baseMember.id,
          title: baseMember.name,
          email: baseMember.email,
        }),
      ]);
    }
  });

  test('typecast single user validates every object before selecting the first', async () => {
    const { table, nameField, ownerField } = await createUserTable('T8238 Single User Array');
    const valid = { id: platformOutsider.id, email: platformOutsider.email };
    const rejected = await post('/tables/createRecords', {
      tableId: table.id,
      typecast: true,
      records: [
        {
          fields: {
            [nameField.id]: 'must not persist',
            [ownerField.id]: [valid, { id: platformOutsider.id, email: 'wrong@example.invalid' }],
          },
        },
      ],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: { code: 'validation.field.user_not_found' },
    });
    expect(await ctx.listRecordsWithoutDrain(table.id)).toHaveLength(0);

    const accepted = await post('/tables/createRecords', {
      tableId: table.id,
      typecast: true,
      records: [
        {
          fields: {
            [nameField.id]: 'first wins',
            [ownerField.id]: [valid, { id: baseMember.id }],
          },
        },
      ],
    });
    expect(accepted.status).toBe(201);
    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      email: platformOutsider.email,
    });
    const update = await post('/tables/updateRecord', {
      tableId: table.id,
      recordId: records[0]!.id,
      typecast: true,
      fields: {
        [ownerField.id]: [valid, { id: platformOutsider.id, email: 'wrong@example.invalid' }],
      },
    });
    expect(update.status).toBe(400);
    const [unchanged] = await ctx.listRecordsWithoutDrain(table.id);
    expect(unchanged?.fields[ownerField.id]).toMatchObject({ id: platformOutsider.id });
  });

  test('typecast updates reject mixed member arrays without changing existing members', async () => {
    const { table, nameField, membersField } = await createUserTable('T8238 Typecast Update');
    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'existing members',
      [membersField.id]: [{ id: baseMember.id }],
    });
    const rejected = await post('/tables/updateRecord', {
      tableId: table.id,
      recordId: record.id,
      fields: {
        [membersField.id]: [{ id: spaceMember.id }, { id: platformOutsider.id }],
      },
      typecast: true,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: { code: 'validation.field.user_not_found' },
    });
    const [stored] = await ctx.listRecordsWithoutDrain(table.id);
    expect(stored?.fields[membersField.id]).toEqual([
      expect.objectContaining({ id: baseMember.id, email: baseMember.email }),
    ]);
  });

  test('typecast and paste still accept target base and space collaborators', async () => {
    const { table, nameField, ownerField, membersField } = await createUserTable(
      'T8238 Authorized Structured Members'
    );
    const accepted = await post('/tables/createRecords', {
      tableId: table.id,
      records: [{ fields: { [nameField.id]: 'allowed', [ownerField.id]: { id: baseMember.id } } }],
      typecast: true,
    });
    expect(accepted.status).toBe(201);
    const membersIndex = table.fields.findIndex((field) => field.id === membersField.id);
    await ctx.paste({
      tableId: table.id,
      viewId: table.views[0].id,
      ranges: [
        [membersIndex, 0],
        [membersIndex, 0],
      ],
      content: [[[{ id: baseMember.id }, { id: spaceMember.id }]]],
      typecast: true,
      sourceFields: [{ type: 'user', cellValueType: 'string', isMultipleCellValue: true }],
    });
    const [stored] = await ctx.listRecordsWithoutDrain(table.id);
    expect(stored?.fields[ownerField.id]).toMatchObject({
      id: baseMember.id,
      email: baseMember.email,
    });
    expect(stored?.fields[membersField.id]).toEqual([
      expect.objectContaining({ id: baseMember.id, email: baseMember.email }),
      expect.objectContaining({ id: spaceMember.id, email: spaceMember.email }),
    ]);
  });

  test('existing member values and server-side duplicates survive membership revocation', async () => {
    const { table, nameField, ownerField } = await createUserTable('T8238 Historical Member');
    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'historical owner',
      [ownerField.id]: { id: baseMember.id },
    });
    await ctx.testContainer.db
      .deleteFrom('collaborator')
      .where('id', '=', 'colT8238BaseMember')
      .execute();
    try {
      await ctx.updateRecord(table.id, record.id, { [nameField.id]: 'unrelated update' });
      await ctx.duplicateRecord(table.id, record.id);
      const records = await ctx.listRecordsWithoutDrain(table.id);
      expect(records).toHaveLength(2);
      for (const stored of records) {
        expect(stored.fields[ownerField.id]).toMatchObject({
          id: baseMember.id,
          email: baseMember.email,
        });
      }
    } finally {
      await ctx.testContainer.db
        .insertInto('collaborator')
        .values({
          id: 'colT8238BaseMember',
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: baseMember.id,
          principal_type: 'user',
        })
        .execute();
    }
  });

  test('batch typecast updates cannot opt into trusted member values', async () => {
    const { table, nameField, ownerField } = await createUserTable('T8238 Batch Scope');
    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'batch target',
      [ownerField.id]: { id: baseMember.id },
    });
    const rejected = await post('/tables/updateRecords', {
      tableId: table.id,
      records: [{ id: record.id, fields: { [ownerField.id]: { id: platformOutsider.id } } }],
      typecast: true,
      valuesAreValidated: true,
      requireCollaborator: false,
      source: { type: 'recordDuplicate' },
    });
    expect(rejected.status).toBe(400);
    const [stored] = await ctx.listRecordsWithoutDrain(table.id);
    expect(stored?.fields[ownerField.id]).toMatchObject({ id: baseMember.id });
  });

  test('bulk update persists a canonical outsider pair and rejects a mismatched pair without mutation', async () => {
    const { table, nameField, ownerField } = await createUserTable(
      'T8238 Bulk Structured Identity Scope'
    );
    const record = await ctx.createRecord(table.id, {
      [nameField.id]: 'bulk structured target',
      [ownerField.id]: { id: baseMember.id },
    });

    const accepted = await post('/tables/updateRecords', {
      tableId: table.id,
      records: [
        {
          id: record.id,
          fields: {
            [ownerField.id]: { id: platformOutsider.id, email: platformOutsider.email },
          },
        },
      ],
      typecast: true,
    });
    expect(accepted.status).toBe(200);

    const [canonical] = await ctx.listRecordsWithoutDrain(table.id);
    expect(canonical?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });

    const rejected = await post('/tables/updateRecords', {
      tableId: table.id,
      records: [
        {
          id: record.id,
          fields: {
            [ownerField.id]: {
              id: platformOutsider.id,
              email: 'wrong-bulk-outsider-email@example.invalid',
            },
          },
        },
      ],
      typecast: true,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: { code: 'validation.field.user_not_found' },
    });

    const [unchanged] = await ctx.listRecordsWithoutDrain(table.id);
    expect(unchanged?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });
  });

  test('form typecast submissions reject a structured outsider', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8238 Form Scope',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      views: [{ type: 'form', name: 'Form' }],
    });
    tableIds.push(table.id);
    const nameField = table.fields.find((field) => field.name === 'Name');
    const ownerField = table.fields.find((field) => field.name === 'Owner');
    const form = table.views.find((view) => view.type === 'form');
    if (!nameField || !ownerField || !form) throw new Error('Missing form fields');
    await ctx.testContainer.db
      .updateTable('view')
      .set({
        column_meta: JSON.stringify({
          [nameField.id]: { order: 0, visible: true },
          [ownerField.id]: { order: 1, visible: true },
        }),
      })
      .where('id', '=', form.id)
      .execute();
    const rejected = await post('/tables/submitRecord', {
      tableId: table.id,
      formId: form.id,
      fields: { [nameField.id]: 'submitted', [ownerField.id]: { id: platformOutsider.id } },
      typecast: true,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: { code: 'validation.field.user_not_found' },
    });
    expect(await ctx.listRecordsWithoutDrain(table.id)).toHaveLength(0);
  });

  test('form submission persists a canonical outsider pair and rejects a mismatched pair without mutation', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8238 Form Structured Identity Scope',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false } },
      ],
      views: [{ type: 'form', name: 'Form' }],
    });
    tableIds.push(table.id);
    const nameField = table.fields.find((field) => field.name === 'Name');
    const ownerField = table.fields.find((field) => field.name === 'Owner');
    const form = table.views.find((view) => view.type === 'form');
    if (!nameField || !ownerField || !form) throw new Error('Missing structured form fields');
    await ctx.testContainer.db
      .updateTable('view')
      .set({
        column_meta: JSON.stringify({
          [nameField.id]: { order: 0, visible: true },
          [ownerField.id]: { order: 1, visible: true },
        }),
      })
      .where('id', '=', form.id)
      .execute();

    const accepted = await post('/tables/submitRecord', {
      tableId: table.id,
      formId: form.id,
      fields: {
        [nameField.id]: 'canonical form outsider',
        [ownerField.id]: { id: platformOutsider.id, email: platformOutsider.email },
      },
      typecast: true,
    });
    expect(accepted.status).toBe(201);

    const [canonical] = await ctx.listRecordsWithoutDrain(table.id);
    expect(canonical?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });

    const rejected = await post('/tables/submitRecord', {
      tableId: table.id,
      formId: form.id,
      fields: {
        [nameField.id]: 'mismatched form outsider',
        [ownerField.id]: {
          id: platformOutsider.id,
          email: 'wrong-form-outsider-email@example.invalid',
        },
      },
      typecast: true,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      ok: false,
      error: { code: 'validation.field.user_not_found' },
    });

    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });
  });

  test('public upsert command rejects a strict structured platform outsider', async () => {
    const { table, nameField, ownerField } = await createUserTable('T8238 Upsert Scope');
    await ctx.updateField({
      tableId: table.id,
      fieldId: nameField.id,
      field: { type: 'singleLineText', unique: true },
    });
    const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const command = UpsertRecordsCommand.create({
      tableId: table.id,
      records: [
        {
          fields: {
            [nameField.id]: 'new upsert row',
            [ownerField.id]: { id: platformOutsider.id },
          },
        },
      ],
      matchField: nameField.id,
      onConflict: 'error',
      typecast: false,
      fieldKeyType: 'id',
    })._unsafeUnwrap();
    const rejected = await commandBus.execute(
      { actorId: ActorId.create(ctx.testUser.id)._unsafeUnwrap() },
      command
    );
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.user_not_found',
    });
    expect(await ctx.listRecordsWithoutDrain(table.id)).toHaveLength(0);
  });

  test('public upsert command persists a canonical outsider pair and rejects a mismatched pair without mutation', async () => {
    const { table, nameField, ownerField } = await createUserTable(
      'T8238 Upsert Structured Identity Scope'
    );
    await ctx.updateField({
      tableId: table.id,
      fieldId: nameField.id,
      field: { type: 'singleLineText', unique: true },
    });
    const commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const actor = { actorId: ActorId.create(ctx.testUser.id)._unsafeUnwrap() };
    const acceptedCommand = UpsertRecordsCommand.create({
      tableId: table.id,
      records: [
        {
          fields: {
            [nameField.id]: 'canonical upsert outsider',
            [ownerField.id]: { id: platformOutsider.id, email: platformOutsider.email },
          },
        },
      ],
      matchField: nameField.id,
      onConflict: 'error',
      typecast: false,
      fieldKeyType: 'id',
    })._unsafeUnwrap();
    const accepted = await commandBus.execute(actor, acceptedCommand);
    expect(accepted.isOk()).toBe(true);

    const [canonical] = await ctx.listRecordsWithoutDrain(table.id);
    expect(canonical?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });

    const updatedCommand = UpsertRecordsCommand.create({
      tableId: table.id,
      records: [
        {
          fields: {
            [nameField.id]: 'canonical upsert outsider',
            [ownerField.id]: {
              id: platformOutsider.id,
              email: platformOutsider.email,
              title: 'forged title',
            },
          },
        },
      ],
      matchField: nameField.id,
      onConflict: 'update',
      typecast: false,
      fieldKeyType: 'id',
    })._unsafeUnwrap();
    expect((await commandBus.execute(actor, updatedCommand)).isOk()).toBe(true);
    const [updated] = await ctx.listRecordsWithoutDrain(table.id);
    expect(updated?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });

    const rejectedCommand = UpsertRecordsCommand.create({
      tableId: table.id,
      records: [
        {
          fields: {
            [nameField.id]: 'canonical upsert outsider',
            [ownerField.id]: {
              id: platformOutsider.id,
              email: 'wrong-upsert-outsider-email@example.invalid',
            },
          },
        },
      ],
      matchField: nameField.id,
      onConflict: 'update',
      typecast: false,
      fieldKeyType: 'id',
    })._unsafeUnwrap();
    const rejected = await commandBus.execute(actor, rejectedCommand);
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.field.user_not_found',
    });

    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.fields[ownerField.id]).toMatchObject({
      id: platformOutsider.id,
      title: platformOutsider.name,
      email: platformOutsider.email,
    });
  });

  test('imports resolve collaborator text but never outsider identifiers or JSON text', async () => {
    const { table, ownerField } = await createUserTable('T8238 Import Scope');
    const values = [
      baseMember.id,
      platformOutsider.id,
      JSON.stringify({ id: platformOutsider.id }),
    ];
    const csvData = ['Owner', ...values.map((value) => `"${value.replaceAll('"', '""')}"`)].join(
      '\n'
    );
    await ctx.importRecords({
      tableId: table.id,
      fileType: 'csv',
      sourceColumnMap: { [ownerField.id]: 0 },
      csvData,
      options: { typecast: true },
    });
    const records = await ctx.listRecordsWithoutDrain(table.id);
    expect(records).toHaveLength(3);
    const members = records.map((record) => record.fields[ownerField.id] ?? null);
    expect(members.filter((member) => member !== null)).toEqual([
      expect.objectContaining({ id: baseMember.id, email: baseMember.email }),
    ]);
    expect(members.filter((member) => member === null)).toHaveLength(2);
  });

  test.each([undefined, [{ type: 'user', cellValueType: 'string' }]])(
    'paste rejects a forged structured outsider with source fields %j',
    async (sourceFields) => {
      const { table, nameField, ownerField } = await createUserTable('T8238 Paste Scope');
      await ctx.createRecord(table.id, { [nameField.id]: 'paste target' });
      const ownerFieldIndex = table.fields.findIndex((field) => field.id === ownerField.id);

      const rejected = await post('/tables/paste', {
        tableId: table.id,
        viewId: table.views[0]?.id,
        ranges: [
          [ownerFieldIndex, 0],
          [ownerFieldIndex, 0],
        ],
        content: [[{ id: platformOutsider.id }]],
        typecast: true,
        sourceFields,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body).toMatchObject({
        ok: false,
        error: { code: 'validation.field.user_not_found' },
      });

      const [stored] = await ctx.listRecordsWithoutDrain(table.id);
      expect(stored?.fields[ownerField.id] ?? null).toBeNull();
    }
  );

  test('single select conversion resolves base and space members but not an outsider option', async () => {
    const fieldName = 'Member option';
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8238 Single Select Member Scope',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        {
          type: 'singleSelect',
          name: fieldName,
          options: {
            choices: [baseMember, spaceMember, platformOutsider].map((user, index) => ({
              id: `choT8238Member${index}`,
              name: user.name,
              color: 'blue',
            })),
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    tableIds.push(table.id);
    const primaryField = table.fields.find((field) => field.isPrimary);
    const memberField = table.fields.find((field) => field.name === fieldName);
    if (!primaryField || !memberField) throw new Error('Missing single select test fields');

    const records = await Promise.all(
      [baseMember, spaceMember, platformOutsider].map((user) =>
        ctx.createRecord(table.id, {
          [primaryField.id]: user.id,
          [memberField.id]: user.name,
        })
      )
    );
    await ctx.updateField({
      tableId: table.id,
      fieldId: memberField.id,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });

    const converted = new Map(
      (await ctx.listRecordsWithoutDrain(table.id)).map((record) => [record.id, record])
    );
    const baseMemberValue = converted.get(records[0].id)?.fields[memberField.id];
    expect(baseMemberValue).not.toBeNull();
    expect(baseMemberValue).not.toBeUndefined();
    expect(baseMemberValue).toMatchObject({
      id: baseMember.id,
      title: baseMember.name,
      email: baseMember.email,
    });
    const spaceMemberValue = converted.get(records[1].id)?.fields[memberField.id];
    expect(spaceMemberValue).not.toBeNull();
    expect(spaceMemberValue).not.toBeUndefined();
    expect(spaceMemberValue).toMatchObject({
      id: spaceMember.id,
      title: spaceMember.name,
      email: spaceMember.email,
    });
    expect(converted.get(records[2].id)?.fields[memberField.id]).toBeNull();
  });

  test('incompatible primitive and JSON fields cannot become outsider users', async () => {
    const sourceFields = [
      {
        name: 'Multiple select outsider strings',
        field: {
          type: 'multipleSelect',
          options: {
            choices: [platformOutsider.id, platformOutsider.name, platformOutsider.email].map(
              (name, index) => ({ id: `choT8238Outsider${index}`, name, color: 'blue' })
            ),
          },
        },
        value: [platformOutsider.id, platformOutsider.name, platformOutsider.email],
      },
      { name: 'Checkbox outsider name', field: { type: 'checkbox' }, value: true },
      {
        name: 'Date outsider name',
        field: {
          type: 'date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          },
        },
        value: dateNameOutsider.name,
      },
      { name: 'Rating outsider name', field: { type: 'rating' }, value: 5 },
      { name: 'Number outsider name', field: { type: 'number' }, value: 5 },
      {
        name: 'Attachment outsider JSON',
        field: { type: 'attachment' },
        value: makeAttachmentCell(attachmentSeed, platformOutsider.email),
      },
      {
        name: 'Button JSON payload',
        field: { type: 'button', options: { label: platformOutsider.name, color: 'blue' } },
        value: { count: 5 },
      },
    ] as const;

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T8238 Incompatible Sources to User',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        ...sourceFields.map(({ name, field }) => ({ name, ...field })),
      ],
      views: [{ type: 'grid' }],
    });
    tableIds.push(table.id);
    const primaryField = table.fields.find((field) => field.isPrimary);
    if (!primaryField) throw new Error('Missing primitive source primary field');
    const fieldIds = new Map(table.fields.map((field) => [field.name, field.id]));
    const record = await ctx.createRecord(
      table.id,
      Object.fromEntries([
        [primaryField.id, 'security-shaped primitive values'],
        ...sourceFields.map(({ name, value }) => {
          const fieldId = fieldIds.get(name);
          if (!fieldId) throw new Error(`Missing source field: ${name}`);
          return [fieldId, value];
        }),
      ])
    );

    const beforeConversion = (await ctx.listRecordsWithoutDrain(table.id)).find(
      (candidate) => candidate.id === record.id
    );
    expect(beforeConversion).toBeDefined();
    for (const { name } of sourceFields) {
      const fieldId = fieldIds.get(name);
      expect(fieldId).toBeDefined();
      const sourceValue = beforeConversion!.fields[fieldId!];
      expect(sourceValue).not.toBeNull();
      expect(sourceValue).not.toBeUndefined();
    }

    for (const { name } of sourceFields) {
      const fieldId = fieldIds.get(name);
      if (!fieldId) throw new Error(`Missing source field: ${name}`);
      await ctx.updateField({
        tableId: table.id,
        fieldId,
        field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
      });
    }

    const converted = (await ctx.listRecordsWithoutDrain(table.id)).find(
      (candidate) => candidate.id === record.id
    );
    expect(converted).toBeDefined();
    for (const { name } of sourceFields) {
      const fieldId = fieldIds.get(name);
      expect(fieldId).toBeDefined();
      expect(converted!.fields).toHaveProperty(fieldId!);
      expect(converted!.fields[fieldId!]).toBeNull();
    }
  });
});
