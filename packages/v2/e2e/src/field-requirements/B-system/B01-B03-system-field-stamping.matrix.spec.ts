/**
 * B01 / B02 / B03 — system field stamping and tracking.
 *
 * B01 (建议需求): created time/by are stamped once at creation and survive later
 * edits, including an explicit write attempt through the API.
 * B02 (实现依据): `lastModifiedTime`/`lastModifiedBy` accept `trackedFieldIds`
 * and must only advance for the tracked fields. Empty tracking is explicitly
 * persisted as []; deleting tracked fields removes only those references and
 * resumes tracking all fields when the list becomes empty.
 * B03 (待定口径): the requirement document asks whether a no-op edit or a
 * config-only change counts as a modification. Both are characterised below.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import {
  ActorId,
  DeleteFieldsCommand,
  TableActionTriggerRequested,
  v2CoreTokens,
  type IEventBus,
} from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, test, vi } from 'vitest';
import {
  fieldByName,
  fieldOptions,
  findRow,
  getSharedTestContext,
  readValue,
  type SharedTestContext,
} from '../../shared/requirementTestUtils';
import {
  buildUndoRedoContext,
  executeRedo,
  executeUndo,
  getCommandBus,
} from '../../undo-redo/shared/undoRedoE2eTestKit';

const TEST_USER_ID = 'usrTestUserId';
const OTHER_USER_ID = 'usrAuditOtherEditor';

describe('B01/B02/B03: system field stamping and tracking', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let otherServer: Server;
  let otherBaseUrl: string;
  const ids: Record<string, string> = {};

  const readRow = async (recordId: string) => {
    const rows = await ctx.listRecords(tableId, { limit: 1000 });
    const row = findRow(rows, recordId);
    if (!row) throw new Error(`row ${recordId} not found`);
    return row;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  const updateAsOtherActor = async (
    targetTableId: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${otherBaseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: targetTableId, recordId, fields }),
    });
    expect(response.status, await response.text()).toBe(200);
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    await ctx.testContainer.db
      .insertInto('users')
      .values({ id: OTHER_USER_ID, name: 'Other editor', email: 'other-editor@example.test' })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => ctx.testContainer.container,
        createExecutionContext: () => ({
          actorId: ActorId.create(OTHER_USER_ID)._unsafeUnwrap(),
          windowId: 'audit-other-editor',
        }),
      })
    );
    otherServer = await new Promise<Server>((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    const address = otherServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address');
    otherBaseUrl = `http://127.0.0.1:${address.port}`;
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'B01 System Fields',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'Tracked' },
        { type: 'singleLineText', name: 'Untracked' },
        { type: 'createdTime', name: 'CreatedTime' },
        { type: 'createdBy', name: 'CreatedBy' },
        { type: 'lastModifiedTime', name: 'ModifiedTimeAll' },
        { type: 'lastModifiedBy', name: 'ModifiedByAll' },
        { type: 'lastModifiedTime', name: 'ModifiedTimeTracked' },
        { type: 'lastModifiedBy', name: 'ModifiedByTracked' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;

    // `trackedFieldIds` needs the tracked column id, so it is wired after the
    // table exists.
    const trackedId = fieldByName(table, 'Tracked').id;
    for (const name of ['ModifiedTimeTracked', 'ModifiedByTracked']) {
      await ctx.updateField({
        tableId,
        fieldId: fieldByName(table, name).id,
        field: { options: { trackedFieldIds: [trackedId] } },
      });
    }

    const fresh = await ctx.getTableById(tableId);
    for (const field of fresh.fields) ids[field.name] = field.id;
  });

  afterAll(async () => {
    if (tableId) await ctx.deleteTable(tableId).catch(() => undefined);
    await new Promise<void>((resolve, reject) => {
      otherServer.close((error) => (error ? reject(error) : resolve()));
      otherServer.closeAllConnections();
    });
  });

  test('B01 created time/by are stamped at creation', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Title]: 'row' });
    const row = await readRow(record.id);

    expect(typeof row.fields[ids.CreatedTime]).toBe('string');
    expect(Number.isNaN(Date.parse(row.fields[ids.CreatedTime] as string))).toBe(false);
    expect(row.fields[ids.CreatedBy]).toMatchObject({ id: TEST_USER_ID });
  });

  test('B01 a payload of only system fields succeeds without changing values', async () => {
    const record = await ctx.createRecord(tableId, {});
    const before = await readRow(record.id);

    // System-only assignments are silently ignored, including modification stamps.
    const updated = await ctx.updateRecord(tableId, record.id, {
      [ids.CreatedTime]: '2000-01-01T00:00:00.000Z',
      [ids.CreatedBy]: 'usrSomeoneElse',
    });
    for (const [fieldId, value] of Object.entries(before.fields)) {
      expect(updated.fields[fieldId] ?? null).toEqual(value ?? null);
    }

    const after = await readRow(record.id);
    expect(after.fields[ids.CreatedTime]).toBe(before.fields[ids.CreatedTime]);
    expect(after.fields[ids.CreatedBy]).toEqual(before.fields[ids.CreatedBy]);
    expect(after.fields).toEqual(before.fields);
  });

  test('B01 system fields mixed into a normal write are ignored', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Title]: 'original' });
    const before = await readRow(record.id);

    const updated = await ctx.updateRecord(tableId, record.id, {
      [ids.Title]: 'changed',
      [ids.CreatedTime]: '2000-01-01T00:00:00.000Z',
      [ids.CreatedBy]: 'usrSomeoneElse',
      [ids.ModifiedTimeAll]: '2000-01-01T00:00:00.000Z',
    });
    expect(updated.fields[ids.Title]).toBe('changed');

    const after = await readRow(record.id);
    expect(after.fields[ids.CreatedTime]).toBe(before.fields[ids.CreatedTime]);
    expect(after.fields[ids.CreatedBy]).toEqual(before.fields[ids.CreatedBy]);
    expect(after.fields[ids.ModifiedTimeAll]).not.toBe('2000-01-01T00:00:00.000Z');
  });

  test('B01 the create payload cannot pre-seed created time/by', async () => {
    const record = await ctx.createRecord(tableId, {
      [ids.CreatedTime]: '2000-01-01T00:00:00.000Z',
      [ids.CreatedBy]: 'usrSomeoneElse',
    });
    const row = await readRow(record.id);

    expect(row.fields[ids.CreatedTime]).not.toBe('2000-01-01T00:00:00.000Z');
    expect(row.fields[ids.CreatedBy]).toMatchObject({ id: TEST_USER_ID });
  });

  test('B02 an edit to a tracked field advances the tracked stamps', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: 'b' });
    const after = await readRow(record.id);

    expect(Date.parse(after.fields[ids.ModifiedTimeTracked] as string)).toBeGreaterThan(
      Date.parse(before.fields[ids.ModifiedTimeTracked] as string)
    );
    expect(after.fields[ids.ModifiedByTracked]).toMatchObject({ id: TEST_USER_ID });
  });

  /**
   * B02 — tracked fields only advance the stamp for the configured list.
   *
   * An empty list means "track all"; restricted tracking needs a stored column.
   * Narrowing a generated modification-time field must migrate it to stored
   * values. Deletion cleanup keeps that storage and its historical stamps,
   * while later record writes also support track-all on the stored column.
   */
  test('B02 an edit to an untracked field leaves the tracked stamps alone', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Untracked]: 'y' });
    const after = await readRow(record.id);

    expect(after.fields[ids.ModifiedTimeTracked]).toBe(before.fields[ids.ModifiedTimeTracked]);
    expect(after.fields[ids.ModifiedByTracked]).toEqual(before.fields[ids.ModifiedByTracked]);
    // The tracking-free stamps still moved.
    expect(Date.parse(after.fields[ids.ModifiedTimeAll] as string)).toBeGreaterThan(
      Date.parse(before.fields[ids.ModifiedTimeAll] as string)
    );
  });

  test('B02 updating a field created with trackedFieldIds only follows the tracked list', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'lastModifiedTime',
        name: 'ModifiedTimeInline',
        options: { trackedFieldIds: [ids.Tracked] },
      },
    });
    const fieldId = fieldByName(created, 'ModifiedTimeInline').id;

    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);
    expect(before.fields[fieldId]).toBeTruthy();

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Untracked]: 'y' });
    expect((await readRow(record.id)).fields[fieldId]).toBe(before.fields[fieldId]);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: 'b' });
    expect(Date.parse((await readRow(record.id)).fields[fieldId] as string)).toBeGreaterThan(
      Date.parse(before.fields[fieldId] as string)
    );
  });

  test('B02 widening the tracking list back to track-all resumes stamping every edit', async () => {
    const created = await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'lastModifiedTime',
        name: 'ModifiedTimeWiden',
        options: { trackedFieldIds: [ids.Tracked] },
      },
    });
    const fieldId = fieldByName(created, 'ModifiedTimeWiden').id;

    await ctx.updateField({
      tableId,
      fieldId,
      field: { options: { trackedFieldIds: [] } },
    });
    const reloaded = await ctx.getTableById(tableId);
    // An empty list explicitly represents the default "track all" configuration.
    const tracked = (
      fieldByName(reloaded, 'ModifiedTimeWiden').options as {
        trackedFieldIds?: string[];
      }
    ).trackedFieldIds;
    expect(tracked).toEqual([]);

    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'a', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Untracked]: 'y' });
    expect((await readRow(record.id)).fields[fieldId]).not.toBe(before.fields[fieldId]);
  });

  test('B02 the persisted trackedFieldIds configuration is round-tripped', async () => {
    const table = await ctx.getTableById(tableId);
    for (const name of ['ModifiedTimeTracked', 'ModifiedByTracked']) {
      const options = fieldByName(table, name).options as { trackedFieldIds?: string[] };
      expect(options.trackedFieldIds).toEqual([ids.Tracked]);
    }
  });

  test.each(['single', 'batch'] as const)(
    'B02 deleting the last tracked field preserves undo history and notifies lookups (%s)',
    async (mode) => {
      const source = await ctx.createTable({
        baseId: ctx.baseId,
        name: `Audit history ${mode}`,
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'singleLineText', name: 'Tracked' },
        ],
      });
      let targetId: string | undefined;
      const eventBus = ctx.testContainer.container.resolve<IEventBus>(v2CoreTokens.eventBus);
      const published = vi.spyOn(eventBus, 'publishMany');
      try {
        const titleId = fieldByName(source, 'Title').id;
        const trackedId = fieldByName(source, 'Tracked').id;
        for (const type of ['lastModifiedTime', 'lastModifiedBy'] as const) {
          await ctx.createField({
            baseId: ctx.baseId,
            tableId: source.id,
            field: { type, name: type, options: { trackedFieldIds: [trackedId] } },
          });
        }
        const fields = await ctx.getTableById(source.id);
        const timeId = fieldByName(fields, 'lastModifiedTime').id;
        const byId = fieldByName(fields, 'lastModifiedBy').id;
        // Leave the tracked cell empty: restoring it must not accidentally
        // re-stamp audit fields and hide a destructive storage conversion.
        const record = await ctx.createRecord(source.id, { [titleId]: 'created' });
        const original = (await ctx.listRecords(source.id))[0];
        const target = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Audit lookup ${mode}`,
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        });
        targetId = target.id;
        const linked = await ctx.createField({
          baseId: ctx.baseId,
          tableId: target.id,
          field: {
            type: 'link',
            name: 'Source',
            options: {
              relationship: 'manyOne',
              foreignTableId: source.id,
              lookupFieldId: titleId,
              isOneWay: true,
            },
          },
        });
        const linkId = fieldByName(linked, 'Source').id;
        const lookedUp = await ctx.createField({
          baseId: ctx.baseId,
          tableId: target.id,
          field: {
            type: 'lookup',
            name: 'Audit time',
            options: { linkFieldId: linkId, foreignTableId: source.id, lookupFieldId: timeId },
          },
        });
        const lookupId = fieldByName(lookedUp, 'Audit time').id;
        const targetRecord = await ctx.createRecord(target.id, { [linkId]: { id: record.id } });
        const lookupBefore = await readValue(ctx, target.id, targetRecord.id, lookupId);
        expect([lookupBefore].flat()).toEqual([original.fields[timeId]]);
        await settle();
        await updateAsOtherActor(source.id, record.id, { [titleId]: 'untracked update' });
        const beforeDelete = (await ctx.listRecords(source.id))[0];
        expect(beforeDelete.fields[timeId]).toEqual(original.fields[timeId]);
        expect(beforeDelete.fields[byId]).toMatchObject({ id: TEST_USER_ID });
        published.mockClear();

        if (mode === 'single') {
          await ctx.deleteField({ tableId: source.id, fieldId: trackedId });
        } else {
          (
            await getCommandBus(ctx).execute(
              buildUndoRedoContext(),
              DeleteFieldsCommand.create({
                baseId: ctx.baseId,
                tableId: source.id,
                fieldIds: [trackedId],
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
        }
        const notifications = published.mock.calls.flatMap(([, events]) => events);
        expect(
          notifications.some(
            (event) =>
              event instanceof TableActionTriggerRequested &&
              event.tableId.toString() === target.id &&
              event.actionKey === 'setField'
          )
        ).toBe(true);
        const afterDelete = (await ctx.listRecords(source.id))[0];
        expect(afterDelete.fields[timeId]).toEqual(original.fields[timeId]);
        expect(afterDelete.fields[byId]).toEqual(original.fields[byId]);
        const lookupAfter = await readValue(ctx, target.id, targetRecord.id, lookupId);
        expect([lookupAfter].flat()).toEqual([afterDelete.fields[timeId]]);

        await executeUndo(ctx, source.id);
        const restored = await ctx.getTableById(source.id);
        expect(fieldOptions(fieldByName(restored, 'lastModifiedTime')).trackedFieldIds).toEqual([
          trackedId,
        ]);
        const afterUndo = (await ctx.listRecords(source.id))[0];
        expect(afterUndo.fields[timeId]).toEqual(original.fields[timeId]);
        expect(afterUndo.fields[byId]).toEqual(original.fields[byId]);
        expect([await readValue(ctx, target.id, targetRecord.id, lookupId)].flat()).toEqual([
          afterUndo.fields[timeId],
        ]);

        await executeRedo(ctx, source.id);
        const redone = await ctx.getTableById(source.id);
        expect(fieldOptions(fieldByName(redone, 'lastModifiedTime')).trackedFieldIds).toEqual([]);
        const afterRedo = (await ctx.listRecords(source.id))[0];
        expect([await readValue(ctx, target.id, targetRecord.id, lookupId)].flat()).toEqual([
          afterRedo.fields[timeId],
        ]);
        await executeUndo(ctx, source.id);
        const afterSecondUndo = (await ctx.listRecords(source.id))[0];
        expect(afterSecondUndo.fields[timeId]).toEqual(original.fields[timeId]);
        expect(afterSecondUndo.fields[byId]).toEqual(original.fields[byId]);
        expect([await readValue(ctx, target.id, targetRecord.id, lookupId)].flat()).toEqual([
          afterSecondUndo.fields[timeId],
        ]);
        await executeRedo(ctx, source.id);
        await settle();
        await updateAsOtherActor(source.id, record.id, { [titleId]: 'track-all resumes' });
        const afterEdit = (await ctx.listRecords(source.id))[0];
        expect(Date.parse(afterEdit.fields[timeId] as string)).toBeGreaterThan(
          Date.parse(original.fields[timeId] as string)
        );
        expect([await readValue(ctx, target.id, targetRecord.id, lookupId)].flat()).toEqual([
          afterEdit.fields[timeId],
        ]);
      } finally {
        published.mockRestore();
        if (targetId) await ctx.deleteTable(targetId);
        await ctx.deleteTable(source.id);
      }
    }
  );

  test('B02 converting a number to modified-by initializes existing stored snapshots', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Audit conversion initialization',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Value' },
      ],
    });
    try {
      const titleId = fieldByName(table, 'Title').id;
      const valueId = fieldByName(table, 'Value').id;
      const record = await ctx.createRecord(table.id, { [titleId]: 'before', [valueId]: 12 });
      await updateAsOtherActor(table.id, record.id, { [titleId]: 'updated' });
      await ctx.updateField({
        tableId: table.id,
        fieldId: valueId,
        field: { type: 'lastModifiedBy' },
      });
      const row = (await ctx.listRecords(table.id))[0];
      expect(row.fields[valueId]).toMatchObject({ id: OTHER_USER_ID });
      // API user projections can fall back to system metadata even for a null
      // snapshot. Assert the converted physical column was actually initialized.
      const field = await ctx.testContainer.db
        .selectFrom('field')
        .select('db_field_name')
        .where('id', '=', valueId)
        .executeTakeFirstOrThrow();
      const physicalTable = await ctx.testContainer.db
        .selectFrom('table_meta')
        .select('db_table_name')
        .where('id', '=', table.id)
        .executeTakeFirstOrThrow();
      const stored = await sql<{ actor: unknown }>`
        SELECT ${sql.ref(field.db_field_name)} AS actor
        FROM ${sql.table(physicalTable.db_table_name)} WHERE __id = ${record.id}
      `.execute(ctx.testContainer.db);
      expect(stored.rows[0].actor).toMatchObject({ id: OTHER_USER_ID });
    } finally {
      await ctx.deleteTable(table.id);
    }
  });

  test('B02 default audit configuration is persisted and stamps subsequent edits', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Title]: 'before' });
    for (const type of ['lastModifiedTime', 'lastModifiedBy'] as const) {
      const created = await ctx.createField({
        baseId: ctx.baseId,
        tableId,
        field: { type, name: `Default ${type}` },
      });
      const audit = fieldByName(created, `Default ${type}`);
      expect(fieldOptions(audit).trackedFieldIds).toEqual([]);
      const stored = await ctx.testContainer.db
        .selectFrom('field')
        .select('options')
        .where('id', '=', audit.id)
        .executeTakeFirstOrThrow();
      expect(JSON.parse(stored.options!).trackedFieldIds).toEqual([]);
    }
    const fresh = await ctx.getTableById(tableId);
    const time = fieldByName(fresh, 'Default lastModifiedTime');
    const by = fieldByName(fresh, 'Default lastModifiedBy');
    expect(fieldOptions(time).trackedFieldIds).toEqual([]);
    expect(fieldOptions(by).trackedFieldIds).toEqual([]);
    const before = await readRow(record.id);
    expect(before.fields[by.id]).toMatchObject({ id: TEST_USER_ID });
    await settle();
    await updateAsOtherActor(tableId, record.id, { [ids.Title]: 'after' });
    const after = await readRow(record.id);
    expect(Date.parse(after.fields[time.id] as string)).toBeGreaterThan(
      Date.parse(before.fields[time.id] as string)
    );
    expect(after.fields[by.id]).toMatchObject({ id: OTHER_USER_ID });
  });

  test('B02 deleting tracked fields preserves survivors then persists track-all', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Audit deletion lifecycle',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'singleLineText', name: 'First' },
        { type: 'singleLineText', name: 'Second' },
      ],
      views: [{ type: 'grid' }],
    });
    try {
      const title = fieldByName(table, 'Title').id;
      const first = fieldByName(table, 'First').id;
      const second = fieldByName(table, 'Second').id;
      for (const type of ['lastModifiedTime', 'lastModifiedBy'] as const) {
        await ctx.createField({
          baseId: ctx.baseId,
          tableId: table.id,
          field: { type, name: type, options: { trackedFieldIds: [first, second] } },
        });
      }
      const initial = await ctx.getTableById(table.id);
      const time = fieldByName(initial, 'lastModifiedTime').id;
      const by = fieldByName(initial, 'lastModifiedBy').id;
      const record = await ctx.createRecord(table.id, { [title]: 'before', [second]: 'a' });
      await ctx.deleteField({ tableId: table.id, fieldId: first });
      for (const remaining of [[second], []]) {
        const fresh = await ctx.getTableById(table.id);
        for (const name of ['lastModifiedTime', 'lastModifiedBy']) {
          const audit = fieldByName(fresh, name);
          expect(fieldOptions(audit).trackedFieldIds).toEqual(remaining);
          const stored = await ctx.testContainer.db
            .selectFrom('field')
            .select('options')
            .where('id', '=', audit.id)
            .executeTakeFirstOrThrow();
          expect(JSON.parse(stored.options!).trackedFieldIds).toEqual(remaining);
        }
        const before = await ctx.listRecords(table.id);
        await settle();
        if (remaining.length) {
          await updateAsOtherActor(table.id, record.id, { [title]: 'untracked edit' });
        } else {
          await ctx.updateRecord(table.id, record.id, { [title]: 'track-all edit' });
        }
        const after = await ctx.listRecords(table.id);
        if (remaining.length) {
          expect(after[0].fields[time]).toBe(before[0].fields[time]);
          expect(after[0].fields[by]).toEqual(before[0].fields[by]);
          expect(after[0].fields[by]).toMatchObject({ id: TEST_USER_ID });
          await settle();
          await updateAsOtherActor(table.id, record.id, { [second]: 'b' });
          const tracked = await ctx.listRecords(table.id);
          expect(Date.parse(tracked[0].fields[time] as string)).toBeGreaterThan(
            Date.parse(after[0].fields[time] as string)
          );
          expect(tracked[0].fields[by]).toMatchObject({ id: OTHER_USER_ID });
          await ctx.deleteField({ tableId: table.id, fieldId: second });
        } else {
          expect(before[0].fields[by]).toMatchObject({ id: OTHER_USER_ID });
          expect(Date.parse(after[0].fields[time] as string)).toBeGreaterThan(
            Date.parse(before[0].fields[time] as string)
          );
          expect(after[0].fields[by]).toMatchObject({ id: TEST_USER_ID });
        }
      }
    } finally {
      await ctx.deleteTable(table.id);
    }
  });

  test('B03 an edit that changes no value does not advance the modification time', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'same', [ids.Untracked]: 'x' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: 'same', [ids.Untracked]: 'x' });
    const after = await readRow(record.id);

    expect(after.fields[ids.ModifiedTimeAll]).toBe(before.fields[ids.ModifiedTimeAll]);
    expect(after.fields[ids.ModifiedTimeTracked]).toBe(before.fields[ids.ModifiedTimeTracked]);
  });

  test('B03 a field rename does not advance record modification stamps', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'x' });
    const before = await readRow(record.id);

    await ctx.updateField({
      tableId,
      fieldId: ids.Tracked,
      field: { name: 'Tracked renamed' },
    });

    const after = await readRow(record.id);
    expect(after.fields[ids.ModifiedTimeAll]).toBe(before.fields[ids.ModifiedTimeAll]);
  });

  test('B02 clearing a tracked value counts as a modification of that field', async () => {
    const record = await ctx.createRecord(tableId, { [ids.Tracked]: 'to-clear' });
    const before = await readRow(record.id);

    await settle();
    await ctx.updateRecord(tableId, record.id, { [ids.Tracked]: null });
    const after = await readRow(record.id);

    expect(Date.parse(after.fields[ids.ModifiedTimeTracked] as string)).toBeGreaterThan(
      Date.parse(before.fields[ids.ModifiedTimeTracked] as string)
    );
    await expect(readValue(ctx, tableId, record.id, ids.Tracked)).resolves.toBeNull();
  });

  describe('B01 a later edit never re-stamps created fields', () => {
    it('stays put across repeated edits', async () => {
      const record = await ctx.createRecord(tableId, {});
      const created = await readRow(record.id);

      for (const value of ['a', 'b', 'c']) {
        await settle();
        await ctx.updateRecord(tableId, record.id, { [ids.Title]: value });
      }

      const after = await readRow(record.id);
      expect(after.fields[ids.CreatedTime]).toBe(created.fields[ids.CreatedTime]);
      expect(after.fields[ids.CreatedBy]).toEqual(created.fields[ids.CreatedBy]);
    });
  });
});
