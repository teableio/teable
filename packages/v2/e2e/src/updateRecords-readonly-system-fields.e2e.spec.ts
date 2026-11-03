/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import { updateRecordsOkResponseSchema } from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { ActorId, FieldKeyType, getRandomString, RecordsBatchUpdated } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

const OTHER_USER_ID = 'usrBatchReadonlySystemFields';
const OTHER_USER = {
  id: OTHER_USER_ID,
  title: 'Batch system-field editor',
  email: 'batch-system-field-editor@example.test',
};
const SPOOFED_USER = {
  id: 'usrSpoofedBatchSystemFields',
  title: 'Spoofed editor',
  email: 'spoofed-editor@example.test',
};
const SPOOFED_TIME = '2000-01-01T00:00:00.000Z';

type StoredRow = {
  title: unknown;
  modified_time: Date | string | null;
  modified_by: unknown;
};

const asInstant = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
};

describe('v2 HTTP updateRecords readonly system fields on PostgreSQL (e2e)', () => {
  let ctx: SharedTestContext;
  let otherActorServer: Server;
  let otherActorBaseUrl: string;
  const tableIds: string[] = [];

  beforeAll(async () => {
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(ctx.testContainer.connectionString).toMatch(/^postgres(?:ql)?:\/\//);

    await ctx.testContainer.db
      .insertInto('users')
      .values({ id: OTHER_USER.id, name: OTHER_USER.title, email: OTHER_USER.email })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => ctx.testContainer.container,
        createExecutionContext: () => ({
          actorId: ActorId.create(OTHER_USER_ID)._unsafeUnwrap(),
          windowId: 'batch-readonly-system-fields',
        }),
      })
    );
    const serverReady = Promise.withResolvers<Server>();
    const server = app.listen(0, '127.0.0.1', () => serverReady.resolve(server));
    otherActorServer = await serverReady.promise;
    const address = otherActorServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address');
    otherActorBaseUrl = `http://127.0.0.1:${address.port}`;
  }, 120_000);

  afterAll(async () => {
    for (const tableId of tableIds) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
    const serverClosed = Promise.withResolvers<void>();
    otherActorServer.close((error) =>
      error ? serverClosed.reject(error) : serverClosed.resolve()
    );
    otherActorServer.closeAllConnections();
    await serverClosed.promise;
  });

  it('ignores submitted LastModified values, stamps authoritative values, and emits persisted old/new values', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `Batch readonly system fields ${getRandomString(8)}`,
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'lastModifiedTime', name: 'Last Modified Time' },
        { type: 'lastModifiedBy', name: 'Last Modified By' },
      ],
      views: [{ type: 'grid' }],
    });
    tableIds.push(table.id);

    const titleField = table.fields.find((field) => field.name === 'Title');
    const modifiedTimeField = table.fields.find((field) => field.name === 'Last Modified Time');
    const modifiedByField = table.fields.find((field) => field.name === 'Last Modified By');
    if (!titleField || !modifiedTimeField || !modifiedByField) {
      throw new Error('Missing updateRecords system-field fixture fields');
    }

    const record = await ctx.createRecord(table.id, { [titleField.id]: 'before' });
    const tableMeta = await ctx.testContainer.db
      .selectFrom('table_meta')
      .select('db_table_name')
      .where('id', '=', table.id)
      .executeTakeFirstOrThrow();
    const fieldRows = await ctx.testContainer.db
      .selectFrom('field')
      .select(['id', 'db_field_name'])
      .where('id', 'in', [titleField.id, modifiedTimeField.id, modifiedByField.id])
      .execute();
    const dbFieldNameById = new Map(fieldRows.map((field) => [field.id, field.db_field_name]));
    const titleDbFieldName = dbFieldNameById.get(titleField.id);
    const modifiedTimeDbFieldName = dbFieldNameById.get(modifiedTimeField.id);
    const modifiedByDbFieldName = dbFieldNameById.get(modifiedByField.id);
    if (!titleDbFieldName || !modifiedTimeDbFieldName || !modifiedByDbFieldName) {
      throw new Error('Missing PostgreSQL field mapping for updateRecords fixture');
    }

    const readStoredRow = async (): Promise<StoredRow> => {
      const result = await sql<StoredRow>`
        SELECT ${sql.ref(titleDbFieldName)} AS title,
               ${sql.ref(modifiedTimeDbFieldName)} AS modified_time,
               ${sql.ref(modifiedByDbFieldName)} AS modified_by
        FROM ${sql.table(tableMeta.db_table_name)}
        WHERE "__id" = ${record.id}
      `.execute(ctx.testContainer.db);
      const row = result.rows[0];
      if (!row) throw new Error('Missing PostgreSQL record fixture');
      return row;
    };

    const before = await readStoredRow();
    expect(before.title).toBe('before');
    expect(asInstant(before.modified_time)).not.toBeNaN();
    expect(before.modified_by).toMatchObject({ id: ctx.testUser.id });

    const delay = Promise.withResolvers<void>();
    setTimeout(delay.resolve, 20);
    await delay.promise;
    const eventOffset = ctx.testContainer.eventBus.events().length;
    const response = await fetch(`${otherActorBaseUrl}/tables/updateRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: table.id,
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: record.id,
            fields: {
              [titleField.id]: 'after',
              [modifiedTimeField.id]: SPOOFED_TIME,
              [modifiedByField.id]: SPOOFED_USER,
            },
          },
        ],
      }),
    });
    const rawBody: unknown = await response.json();
    expect(response.status, JSON.stringify(rawBody)).toBe(200);
    const parsed = updateRecordsOkResponseSchema.parse(rawBody);
    if (!parsed.ok) throw new Error(`updateRecords failed: ${JSON.stringify(rawBody)}`);
    expect(parsed.data.updatedCount).toBe(1);

    const after = await readStoredRow();
    expect(after.title).toBe('after');
    expect(asInstant(after.modified_time)).toBeGreaterThan(asInstant(before.modified_time));
    expect(asInstant(after.modified_time)).not.toBe(Date.parse(SPOOFED_TIME));
    expect(after.modified_by).toMatchObject(OTHER_USER);
    expect(after.modified_by).not.toMatchObject({ id: SPOOFED_USER.id });

    const events = ctx.testContainer.eventBus
      .events()
      .slice(eventOffset)
      .filter(
        (event): event is RecordsBatchUpdated =>
          event instanceof RecordsBatchUpdated &&
          event.tableId.toString() === table.id &&
          event.source === 'user'
      );
    expect(events).toHaveLength(1);
    const update = events[0]?.updates.find((candidate) => candidate.recordId === record.id);
    expect(update).toBeDefined();
    if (!update) throw new Error('Missing RecordsBatchUpdated record payload');

    const changes = new Map(update.changes.map((change) => [change.fieldId, change]));
    expect([...changes.keys()].sort()).toEqual(
      [titleField.id, modifiedTimeField.id, modifiedByField.id].sort()
    );
    expect(changes.get(titleField.id)).toEqual({
      fieldId: titleField.id,
      oldValue: 'before',
      newValue: 'after',
    });

    const modifiedTimeChange = changes.get(modifiedTimeField.id);
    expect(modifiedTimeChange).toBeDefined();
    expect(asInstant(modifiedTimeChange?.oldValue)).toBe(asInstant(before.modified_time));
    expect(asInstant(modifiedTimeChange?.newValue)).toBe(asInstant(after.modified_time));
    expect(asInstant(modifiedTimeChange?.newValue)).not.toBe(Date.parse(SPOOFED_TIME));

    const modifiedByChange = changes.get(modifiedByField.id);
    expect(modifiedByChange).toBeDefined();
    expect(modifiedByChange?.oldValue).toMatchObject({ id: ctx.testUser.id });
    expect(modifiedByChange?.newValue).toMatchObject(OTHER_USER);
    expect(modifiedByChange?.newValue).not.toMatchObject({ id: SPOOFED_USER.id });
  });
});
