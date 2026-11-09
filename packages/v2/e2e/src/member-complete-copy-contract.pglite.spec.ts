/* eslint-disable @typescript-eslint/naming-convention */
import {
  ActorId,
  buildUserAvatarUrl,
  type ICommandBus,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RedoCommand,
  UndoCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

type FieldLike = { id: string; name: string; type?: string; isPrimary?: boolean };
type UserValue = { id: string; title?: string; email?: string };

const targetBaseMember = {
  id: 'usrT8238CopyBaseMember',
  name: 'T8238 Copy Base Member',
  email: 'copy-base-member@example.invalid',
};
const targetSpaceMember = {
  id: 'usrT8238CopySpaceMember',
  name: 'T8238 Copy Space Member',
  email: 'copy-space-member@example.invalid',
};
const noEmailCollaborator = {
  id: 'usrT8238CopyNoEmail',
  name: 'T8238 Copy No Email',
  email: null,
};
const crossSpaceMember = {
  id: 'usrT8238CopyCrossSpace',
  name: 'T8238 Copy Cross Space',
  email: 'copy-cross-space@example.invalid',
};
const deletedCrossSpaceMember = {
  id: 'usrT8238CopyDeleted',
  name: 'T8238 Copy Deleted',
  email: 'copy-deleted@example.invalid',
};
const outsiderOne = {
  id: 'usrT8238CopyOutsiderOne',
  name: 'T8238 Copy Outsider One',
  email: 'copy-outsider-one@example.invalid',
};
const outsiderTwo = {
  id: 'usrT8238CopyOutsiderTwo',
  name: 'T8238 Copy Outsider Two',
  email: 'copy-outsider-two@example.invalid',
};

const syntheticUserIds = [
  targetBaseMember.id,
  targetSpaceMember.id,
  noEmailCollaborator.id,
  crossSpaceMember.id,
  deletedCrossSpaceMember.id,
  outsiderOne.id,
  outsiderTwo.id,
];

const suffix = Math.random().toString(36).slice(2, 10);
const otherSpaceId = `spcT8238Copy${suffix}`;
const otherBaseId = `bseT8238Copy${suffix}`;

describe('member complete-copy contract (PGlite)', () => {
  let ctx: SharedTestContext;
  let spaceId: string;
  let commandBus: ICommandBus;
  let serial = 0;
  const targetTableIds: string[] = [];
  const crossSpaceTableIds: string[] = [];

  const nextName = (prefix: string) => `T8238 copy ${prefix} ${serial++}`;
  const fieldIdByName = (fields: ReadonlyArray<FieldLike>, name: string) => {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) throw new Error(`Missing field: ${name}`);
    return field.id;
  };
  const canonicalUser = (user: { id: string; name: string; email: string | null }) => ({
    id: user.id,
    title: user.name,
    ...(user.email ? { email: user.email } : {}),
  });
  const expectNoLeak = (serialized: string, users: ReadonlyArray<{ id: string; name: string }>) => {
    for (const user of users) {
      expect(serialized).not.toContain(user.id);
      expect(serialized).not.toContain(user.name);
    }
  };
  const readRecord = async (tableId: string, recordId: string) => {
    const record = (await ctx.listRecords(tableId)).find((candidate) => candidate.id === recordId);
    expect(record, `Record ${recordId} must exist`).toBeDefined();
    return record!;
  };
  const readCell = async (tableId: string, recordId: string, fieldId: string) => {
    const fields = (await readRecord(tableId, recordId)).fields;
    expect(
      Object.prototype.hasOwnProperty.call(fields, fieldId),
      `Field ${fieldId} must be an own key`
    ).toBe(true);
    expect(fields[fieldId], `Field ${fieldId} must be defined`).not.toBeUndefined();
    return fields[fieldId];
  };
  const postJson = async (path: string, body: unknown) => {
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };
  const deleteTableInBase = async (baseId: string, tableId: string) => {
    const response = await fetch(`${ctx.baseUrl}/tables/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId, tableId, mode: 'permanent' }),
    });
    if (!response.ok) throw new Error(await response.text());
  };
  const removeSyntheticDirectory = async () => {
    const db = ctx.testContainer.db;
    await db.deleteFrom('collaborator').where('principal_id', 'in', syntheticUserIds).execute();
    await db.deleteFrom('users').where('id', 'in', syntheticUserIds).execute();
    await db.deleteFrom('base').where('id', '=', otherBaseId).execute();
    await db.deleteFrom('space').where('id', '=', otherSpaceId).execute();
  };
  const pasteUserCell = async (params: {
    tableId: string;
    viewId: string;
    fieldIndex: number;
    rowIndex: number;
    value: unknown;
    isMultiple: boolean;
  }) => {
    return ctx.paste({
      tableId: params.tableId,
      viewId: params.viewId,
      ranges: [
        [params.fieldIndex, params.rowIndex],
        [params.fieldIndex, params.rowIndex],
      ],
      content: [[params.value]],
      typecast: true,
      sourceFields: [
        {
          name: 'Copied user',
          type: 'user',
          cellValueType: 'string',
          isMultipleCellValue: params.isMultiple,
        },
      ],
    });
  };
  const createdUserValues = (tableId: string, fieldId: string, since: number) =>
    ctx.testContainer.eventBus
      .events()
      .slice(since)
      .filter(
        (event): event is RecordsBatchCreated =>
          event instanceof RecordsBatchCreated && event.tableId.toString() === tableId
      )
      .flatMap((event) => event.records)
      .flatMap((record) => record.fields)
      .filter((field) => field.fieldId === fieldId)
      .map((field) => field.value);
  const updatedUserChanges = (tableId: string, fieldId: string, since: number) =>
    ctx.testContainer.eventBus
      .events()
      .slice(since)
      .filter(
        (event): event is RecordsBatchUpdated =>
          event instanceof RecordsBatchUpdated && event.tableId.toString() === tableId
      )
      .flatMap((event) => event.updates)
      .flatMap((update) => update.changes)
      .filter((change) => change.fieldId === fieldId);

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'pglite' });
    commandBus = ctx.testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const base = await ctx.testContainer.db
      .selectFrom('base')
      .select('space_id')
      .where('id', '=', ctx.baseId)
      .executeTakeFirstOrThrow();
    spaceId = base.space_id;

    await removeSyntheticDirectory();
    const db = ctx.testContainer.db;
    await db
      .insertInto('users')
      .values([
        targetBaseMember,
        targetSpaceMember,
        noEmailCollaborator,
        crossSpaceMember,
        outsiderOne,
        outsiderTwo,
      ])
      .execute();
    await db
      .insertInto('users')
      .values({ ...deletedCrossSpaceMember, deleted_time: new Date() })
      .execute();
    await db
      .insertInto('collaborator')
      .values([
        {
          id: 'colT8238CopyBase',
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: targetBaseMember.id,
          principal_type: 'user',
        },
        {
          id: 'colT8238CopySpace',
          resource_type: 'space',
          resource_id: spaceId,
          principal_id: targetSpaceMember.id,
          principal_type: 'user',
        },
        {
          id: 'colT8238CopyNoEmail',
          resource_type: 'base',
          resource_id: ctx.baseId,
          principal_id: noEmailCollaborator.id,
          principal_type: 'user',
        },
        // The cross-space member only belongs to another space. Nothing grants
        // them access to the target base or the target space.
        {
          id: 'colT8238CopyCrossSpace',
          resource_type: 'space',
          resource_id: otherSpaceId,
          principal_id: crossSpaceMember.id,
          principal_type: 'user',
        },
        {
          id: 'colT8238CopyDeleted',
          resource_type: 'space',
          resource_id: otherSpaceId,
          principal_id: deletedCrossSpaceMember.id,
          principal_type: 'user',
        },
      ])
      .execute();
    await db
      .insertInto('space')
      .values({ id: otherSpaceId, name: 'T8238 Copy Other Space', created_by: 'system' })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    await db
      .insertInto('base')
      .values({
        id: otherBaseId,
        space_id: otherSpaceId,
        name: 'T8238 Copy Other Base',
        order: 1,
        created_by: 'system',
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  });

  afterAll(async () => {
    if (!ctx) return;
    for (const tableId of targetTableIds) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
    for (const tableId of crossSpaceTableIds) {
      await deleteTableInBase(otherBaseId, tableId).catch(() => undefined);
    }
    await removeSyntheticDirectory();
  });

  test('a copied complete user object from another space pastes canonically into single and multiple fields', async () => {
    const source = await ctx.createTable({
      baseId: otherBaseId,
      name: nextName('cross-space source'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
        { type: 'user', name: 'Members', options: { isMultiple: true, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    crossSpaceTableIds.push(source.id);
    const sourceRowId = fieldIdByName(source.fields, 'Row');
    const sourceOwnerId = fieldIdByName(source.fields, 'Owner');
    const sourceMembersId = fieldIdByName(source.fields, 'Members');
    const sourceRecord = await ctx.createRecord(source.id, {
      [sourceRowId]: 'copied row',
      [sourceOwnerId]: { id: crossSpaceMember.id, email: crossSpaceMember.email },
      [sourceMembersId]: [{ id: crossSpaceMember.id, email: crossSpaceMember.email }],
    });

    // Read the real cells through the v2 HTTP read path. These are the values a
    // grid copy sends, not a hand-built snapshot.
    const copiedOwner = await readCell(source.id, sourceRecord.id, sourceOwnerId);
    const copiedMembers = await readCell(source.id, sourceRecord.id, sourceMembersId);
    expect(copiedOwner).toMatchObject(canonicalUser(crossSpaceMember));
    expect(Array.isArray(copiedMembers)).toBe(true);

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('cross-space paste target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
        { type: 'user', name: 'Members', options: { isMultiple: true, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');
    const membersFieldId = fieldIdByName(table.fields, 'Members');
    const ownerIndex = table.fields.findIndex((field) => field.id === ownerFieldId);
    const membersIndex = table.fields.findIndex((field) => field.id === membersFieldId);
    const record = await ctx.createRecord(table.id, { [rowFieldId]: 'target row' });
    const viewId = table.views?.[0]?.id;
    if (!viewId) throw new Error('Missing target view');

    const pastedOwner = await pasteUserCell({
      tableId: table.id,
      viewId,
      fieldIndex: ownerIndex,
      rowIndex: 0,
      // Keep the real id/email pair, but a stale title must be canonicalized.
      value: { ...(copiedOwner as UserValue), title: 'Forged copy title' },
      isMultiple: false,
    });
    expect(pastedOwner.updatedCount).toBe(1);
    expect(await readCell(table.id, record.id, ownerFieldId)).toMatchObject(
      canonicalUser(crossSpaceMember)
    );

    const pastedMembers = await pasteUserCell({
      tableId: table.id,
      viewId,
      fieldIndex: membersIndex,
      rowIndex: 0,
      value: copiedMembers,
      isMultiple: true,
    });
    expect(pastedMembers.updatedCount).toBe(1);
    const membersValue = await readCell(table.id, record.id, membersFieldId);
    expect(membersValue).toEqual([expect.objectContaining(canonicalUser(crossSpaceMember))]);
    expect(
      JSON.stringify([membersValue, await readCell(table.id, record.id, ownerFieldId)])
    ).not.toContain('Forged copy title');
  });

  test('a complete cross-space pair is accepted by create and update writes', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('cross-space write target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');

    const created = await ctx.createRecord(table.id, {
      [rowFieldId]: 'created with complete pair',
      [ownerFieldId]: { id: crossSpaceMember.id, email: crossSpaceMember.email },
    });
    expect(await readCell(table.id, created.id, ownerFieldId)).toMatchObject(
      canonicalUser(crossSpaceMember)
    );

    const updated = await ctx.createRecord(table.id, {
      [rowFieldId]: 'updated with complete pair',
    });
    await ctx.updateRecord(table.id, updated.id, {
      [ownerFieldId]: { id: crossSpaceMember.id, email: crossSpaceMember.email },
    });
    expect(await readCell(table.id, updated.id, ownerFieldId)).toMatchObject(
      canonicalUser(crossSpaceMember)
    );
  });

  test('a collaborator id with a different email is rejected without changing the record', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('mismatched pair target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
        { type: 'user', name: 'Members', options: { isMultiple: true, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');
    const membersFieldId = fieldIdByName(table.fields, 'Members');
    const record = await ctx.createRecord(table.id, {
      [rowFieldId]: 'existing owner',
      [ownerFieldId]: { id: targetBaseMember.id, email: targetBaseMember.email },
      [membersFieldId]: [{ id: targetSpaceMember.id, email: targetSpaceMember.email }],
    });

    const rejected = await postJson('/tables/updateRecord', {
      tableId: table.id,
      recordId: record.id,
      fields: { [ownerFieldId]: { id: targetBaseMember.id, email: crossSpaceMember.email } },
      typecast: false,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.text).not.toContain(crossSpaceMember.email);
    expect(rejected.text).not.toContain(crossSpaceMember.name);
    expect(await readCell(table.id, record.id, ownerFieldId)).toMatchObject(
      canonicalUser(targetBaseMember)
    );

    const mixedRejected = await postJson('/tables/updateRecord', {
      tableId: table.id,
      recordId: record.id,
      fields: {
        [membersFieldId]: [
          { id: crossSpaceMember.id, email: crossSpaceMember.email },
          { id: targetBaseMember.id, email: outsiderTwo.email },
        ],
      },
      typecast: false,
    });
    expect(mixedRejected.status).toBe(400);
    expect(mixedRejected.text).not.toContain(outsiderTwo.email);
    expect(await readCell(table.id, record.id, membersFieldId)).toEqual([
      expect.objectContaining(canonicalUser(targetSpaceMember)),
    ]);
  });

  test('unknown and deleted users are rejected even when the pair looks complete', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('unknown and deleted target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');
    const record = await ctx.createRecord(table.id, {
      [rowFieldId]: 'protected row',
      [ownerFieldId]: { id: targetBaseMember.id, email: targetBaseMember.email },
    });

    for (const { pair, privateProfile } of [
      {
        pair: { id: 'usrT8238CopyUnknown', email: 'copy-unknown@example.invalid' },
        privateProfile: undefined,
      },
      {
        pair: { id: deletedCrossSpaceMember.id, email: deletedCrossSpaceMember.email },
        // Name/avatar are real directory data deliberately omitted from the request.
        privateProfile: {
          name: deletedCrossSpaceMember.name,
          avatar: buildUserAvatarUrl(deletedCrossSpaceMember.id),
        },
      },
    ]) {
      const rejected = await postJson('/tables/updateRecord', {
        tableId: table.id,
        recordId: record.id,
        fields: { [ownerFieldId]: pair },
        typecast: false,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.text).not.toContain(pair.email);
      if (privateProfile) {
        expect(rejected.text).not.toContain(privateProfile.name);
        expect(rejected.text).not.toContain(privateProfile.avatar);
      }
      expect(await readCell(table.id, record.id, ownerFieldId)).toMatchObject(
        canonicalUser(targetBaseMember)
      );
    }
  });

  test('bare id, email-only and name-only values cannot resolve platform users globally', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('bare identifier target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');

    for (const identifiers of [
      { id: outsiderOne.id },
      { id: outsiderOne.id, title: outsiderOne.name },
    ]) {
      const rejected = await postJson('/tables/createRecords', {
        tableId: table.id,
        records: [{ fields: { [rowFieldId]: 'bare id', [ownerFieldId]: identifiers } }],
        typecast: false,
      });
      expect(rejected.status).toBe(400);
      expect(rejected.text).not.toContain(outsiderOne.email);
      expect(await ctx.listRecords(table.id)).toHaveLength(0);
    }

    // Without an id the payload is not a user reference at all; the server may
    // echo the caller's own submitted value in the validation detail.
    const emailOnly = await postJson('/tables/createRecords', {
      tableId: table.id,
      records: [
        { fields: { [rowFieldId]: 'email only', [ownerFieldId]: { email: outsiderOne.email } } },
      ],
      typecast: false,
    });
    expect(emailOnly.status).toBe(400);
    expect(await ctx.listRecords(table.id)).toHaveLength(0);

    const typed = await postJson('/tables/createRecords', {
      tableId: table.id,
      typecast: true,
      records: [outsiderOne.id, outsiderOne.email, outsiderOne.name].map((identifier) => ({
        fields: { [rowFieldId]: `typed ${identifier}`, [ownerFieldId]: identifier },
      })),
    });
    expect(typed.status).toBe(201);
    const records = await ctx.listRecords(table.id);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(await readCell(table.id, record.id, ownerFieldId)).toBeNull();
    }
  });

  test('collaborator names still match and a collaborator without email keeps a canonical cell', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('collaborator name target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
        { type: 'user', name: 'Members', options: { isMultiple: true, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');
    const membersFieldId = fieldIdByName(table.fields, 'Members');

    const byName = await postJson('/tables/createRecords', {
      tableId: table.id,
      typecast: true,
      records: [
        {
          fields: {
            [rowFieldId]: 'collaborator name',
            [ownerFieldId]: targetSpaceMember.name,
            [membersFieldId]: [targetBaseMember.name, 'not-a-user'],
          },
        },
      ],
    });
    expect(byName.status).toBe(201);
    const [namedRecord] = await ctx.listRecords(table.id);
    expect(namedRecord, 'name-typed record must exist').toBeDefined();
    expect(await readCell(table.id, namedRecord!.id, ownerFieldId)).toMatchObject(
      canonicalUser(targetSpaceMember)
    );
    expect(await readCell(table.id, namedRecord!.id, membersFieldId)).toEqual([
      expect.objectContaining(canonicalUser(targetBaseMember)),
    ]);

    const withoutEmail = await ctx.createRecord(table.id, {
      [rowFieldId]: 'collaborator without email',
      [ownerFieldId]: { id: noEmailCollaborator.id },
    });
    const stored = await readCell(table.id, withoutEmail.id, ownerFieldId);
    expect(stored).toMatchObject({ id: noEmailCollaborator.id, title: noEmailCollaborator.name });
    expect(JSON.stringify(stored)).not.toContain('@');
  });

  test('text and number conversion cannot promote non-collaborators into user fields', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('conversion escalation target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'singleLineText', name: 'Text source' },
        { type: 'number', name: 'Number source' },
        {
          type: 'user',
          name: 'Single target',
          options: { isMultiple: false, shouldNotify: false },
        },
        {
          type: 'user',
          name: 'Multiple target',
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const textFieldId = fieldIdByName(table.fields, 'Text source');
    const numberFieldId = fieldIdByName(table.fields, 'Number source');
    const singleTargetId = fieldIdByName(table.fields, 'Single target');
    const multipleTargetId = fieldIdByName(table.fields, 'Multiple target');
    const record = await ctx.createRecord(table.id, {
      [rowFieldId]: 'conversion row',
      [textFieldId]: JSON.stringify({ id: outsiderOne.id, email: outsiderOne.email }),
      [numberFieldId]: 20240101,
    });

    await ctx.updateField({
      tableId: table.id,
      fieldId: textFieldId,
      field: { type: 'user', options: { isMultiple: false, shouldNotify: false } },
    });
    expect(await readCell(table.id, record.id, textFieldId)).toBeNull();
    await ctx.updateField({
      tableId: table.id,
      fieldId: numberFieldId,
      field: { type: 'user', options: { isMultiple: true, shouldNotify: false } },
    });
    expect(await readCell(table.id, record.id, numberFieldId)).toBeNull();
    // The replacement fields exist and are independently empty; conversion must
    // not have copied anything into the other user columns either.
    expect(await readCell(table.id, record.id, singleTargetId)).toBeNull();
    expect(await readCell(table.id, record.id, multipleTargetId)).toBeNull();
  });

  test('paste events and undo store only the canonical cross-space identity', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: nextName('history target'),
      fields: [
        { type: 'singleLineText', name: 'Row', isPrimary: true },
        { type: 'user', name: 'Owner', options: { isMultiple: false, shouldNotify: false } },
        { type: 'user', name: 'Members', options: { isMultiple: true, shouldNotify: false } },
      ],
      views: [{ type: 'grid' }],
    });
    targetTableIds.push(table.id);
    const rowFieldId = fieldIdByName(table.fields, 'Row');
    const ownerFieldId = fieldIdByName(table.fields, 'Owner');
    const membersFieldId = fieldIdByName(table.fields, 'Members');
    const ownerIndex = table.fields.findIndex((field) => field.id === ownerFieldId);
    const membersIndex = table.fields.findIndex((field) => field.id === membersFieldId);
    const record = await ctx.createRecord(table.id, { [rowFieldId]: 'history row' });
    const viewId = table.views?.[0]?.id;
    if (!viewId) throw new Error('Missing history view');

    const eventOffset = ctx.testContainer.eventBus.events().length;
    // One paste command covering both columns so undo/redo sees a single entry.
    await ctx.paste({
      tableId: table.id,
      viewId,
      ranges: [
        [ownerIndex, 0],
        [membersIndex, 0],
      ],
      content: [
        [
          {
            id: crossSpaceMember.id,
            title: 'Forged history title',
            email: crossSpaceMember.email,
          },
          [
            {
              id: crossSpaceMember.id,
              title: 'Forged history title',
              email: crossSpaceMember.email,
            },
          ],
        ],
      ],
      typecast: true,
      sourceFields: [
        { type: 'user', cellValueType: 'string', isMultipleCellValue: false },
        { type: 'user', cellValueType: 'string', isMultipleCellValue: true },
      ],
    });

    const ownerChanges = updatedUserChanges(table.id, ownerFieldId, eventOffset);
    expect(ownerChanges).toHaveLength(1);
    expect(ownerChanges[0]?.newValue).toMatchObject(canonicalUser(crossSpaceMember));
    expect(JSON.stringify(ownerChanges)).not.toContain('Forged history title');
    const memberValues = createdUserValues(table.id, membersFieldId, eventOffset);
    expect(memberValues).toEqual([]);
    const memberChanges = updatedUserChanges(table.id, membersFieldId, eventOffset);
    expect(memberChanges).toHaveLength(1);
    expect(memberChanges[0]?.newValue).toEqual([
      expect.objectContaining(canonicalUser(crossSpaceMember)),
    ]);
    expect(JSON.stringify(memberChanges)).not.toContain('Forged history title');

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
    const undone = await readRecord(table.id, record.id);
    expect(undone.fields[ownerFieldId] ?? null).toBeNull();
    expect(undone.fields[membersFieldId] ?? null).toBeNull();

    (
      await commandBus.execute(
        context,
        RedoCommand.create({ tableId: table.id, windowId: context.windowId })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    expect(await readCell(table.id, record.id, ownerFieldId)).toMatchObject(
      canonicalUser(crossSpaceMember)
    );
    expect(await readCell(table.id, record.id, membersFieldId)).toEqual([
      expect.objectContaining(canonicalUser(crossSpaceMember)),
    ]);

    const beforeRejected = ctx.testContainer.eventBus.events().length;
    const rejected = await postJson('/tables/paste', {
      tableId: table.id,
      viewId,
      ranges: [
        [ownerIndex, 0],
        [ownerIndex, 0],
      ],
      content: [[{ id: targetBaseMember.id, email: crossSpaceMember.email }]],
      typecast: true,
      sourceFields: [{ type: 'user', cellValueType: 'string' }],
    });
    expect(rejected.status).toBe(400);
    expect(rejected.text).not.toContain(crossSpaceMember.email);
    expect(ctx.testContainer.eventBus.events()).toHaveLength(beforeRejected);
    expect(await readCell(table.id, record.id, ownerFieldId)).toMatchObject(
      canonicalUser(crossSpaceMember)
    );
    expectNoLeak(JSON.stringify(rejected.text), [outsiderOne, outsiderTwo]);
  });
});
