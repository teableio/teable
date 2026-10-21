/* eslint-disable @typescript-eslint/naming-convention */
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createRecordsErrorResponseSchema,
  createRecordsOkResponseSchema,
  type ICreateRecordsErrorResponseDto,
  type ICreateRecordsOkResponseDto,
  type HttpErrorStatus,
  createTableOkResponseSchema,
  getRecordByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { FieldKeyType, RecordsBatchUpdated } from '@teable/v2-core';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http record compatibility (P0)', () => {
  let ctx: SharedTestContext;
  let tableCounter = 0;
  let attachmentToken = '';
  let attachmentPath = '';
  let attachmentSize = 0;
  let attachmentMimetype = '';
  let attachmentIdCounter = 0;

  const uniqueTableName = (prefix: string) => {
    tableCounter += 1;
    return `${prefix}-${tableCounter}-${Date.now()}`;
  };

  const createTable = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await response.json();
    expect(response.status).toBe(201);
    const parsed = createTableOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Create table failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.table;
  };

  const createField = async (tableId: string, field: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId: ctx.baseId,
        tableId,
        field,
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = createFieldOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Create field failed: ${JSON.stringify(raw)}`);
    }
    const created = parsed.data.data.table.fields.find(
      (entry) => entry.name === field.name || entry.id === field.id
    );
    if (!created) {
      throw new Error(`Failed to find created field: ${JSON.stringify(parsed.data.data.table)}`);
    }
    return created;
  };

  const createRecord = async (tableId: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        fields,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(201);
    const parsed = createRecordOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Create record failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.record;
  };

  type CreateRecordsRecord = ICreateRecordsOkResponseDto['data']['records'][number];
  type CreateRecordsError = ICreateRecordsErrorResponseDto['error'];

  async function createRecords(
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
    expectedStatus?: 201 | HttpErrorStatus
  ): Promise<CreateRecordsRecord[] | CreateRecordsError> {
    const status = expectedStatus ?? 201;
    const response = await fetch(`${ctx.baseUrl}/tables/createRecords`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId, records }),
    });
    const raw = await response.json();
    expect(response.status).toBe(status);
    if (status === 201) {
      const parsed = createRecordsOkResponseSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) {
        throw new Error(`Create records failed: ${JSON.stringify(raw)}`);
      }
      return parsed.data.data.records;
    }

    const parsed = createRecordsErrorResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(`Create records failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.error;
  }

  const updateRecord = async (
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
    typecast = false
  ) => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId,
        fields,
        typecast,
        fieldKeyType: FieldKeyType.Id,
      }),
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = updateRecordOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Update record failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableId: string, fieldKeyType: FieldKeyType = FieldKeyType.Id) => {
    const params = new URLSearchParams({
      tableId,
      fieldKeyType,
    });
    const response = await fetch(`${ctx.baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = listTableRecordsOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`List records failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.records;
  };

  const getRecordById = async (tableId: string, recordId: string) => {
    const params = new URLSearchParams({ tableId, recordId });
    const response = await fetch(`${ctx.baseUrl}/tables/getRecord?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    const raw = await response.json();
    expect(response.status).toBe(200);
    const parsed = getRecordByIdOkResponseSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error(`Get record failed: ${JSON.stringify(raw)}`);
    }
    return parsed.data.data.record;
  };

  const ensureAttachmentTables = async () => {
    await sql
      .raw(
        `create table if not exists attachments (
          id text primary key,
          token text unique not null,
          hash text not null,
          size int not null,
          mimetype text not null,
          path text not null,
          width int,
          height int,
          deleted_time timestamptz,
          created_time timestamptz default now(),
          created_by text not null,
          last_modified_by text,
          thumbnail_path text
        )`
      )
      .execute(ctx.testContainer.db);
  };

  const seedAttachment = async () => {
    attachmentIdCounter += 1;
    const token = `tok_${Date.now()}_${attachmentIdCounter}`;
    const path = `table/DXR3aPmms8EI_${attachmentIdCounter}`;
    const size = 4 + attachmentIdCounter;
    const mimetype = 'text/plain';

    await sql
      .raw(
        `insert into attachments (id, token, hash, size, mimetype, path, created_by)
         values ('att_${Date.now()}_${attachmentIdCounter}', '${token}', 'hash', ${size}, '${mimetype}', '${path}', '${ctx.testUser.id}')
         on conflict (token) do nothing`
      )
      .execute(ctx.testContainer.db);

    return {
      token,
      path,
      size,
      mimetype,
    };
  };

  const listAttachmentRows = async (recordId: string, fieldId: string) => {
    return await ctx.testContainer.db
      .selectFrom('attachments_table')
      .select(['attachment_id', 'token', 'name', 'table_id', 'record_id', 'field_id'])
      .where('record_id', '=', recordId)
      .where('field_id', '=', fieldId)
      .orderBy('token')
      .execute();
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    // Test user is already inserted by globalTestContext
    await ensureAttachmentTables();
    const seeded = await seedAttachment();
    attachmentToken = seeded.token;
    attachmentPath = seeded.path;
    attachmentSize = seeded.size;
    attachmentMimetype = seeded.mimetype;
  });

  describe('audit user fields', () => {
    it('populates CreatedBy on new records', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('audit-created'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const titleFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
      const createdByField = await createField(table.id, {
        type: 'createdBy',
        name: 'Created By',
      });

      const result = await createRecords(table.id, [
        {
          fields: {
            [titleFieldId]: 'alpha',
          },
        },
      ]);
      if (!Array.isArray(result)) {
        throw new Error(`Create records failed: ${JSON.stringify(result)}`);
      }
      const [createdRecord] = result;

      const records = await listRecords(table.id, FieldKeyType.Id);
      const target = records.find((record) => record.id === createdRecord.id);

      expect(target?.fields[createdByField.id]).toMatchObject({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
      });
    });

    it('updates LastModifiedBy on record update', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('audit-last-mod'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const titleFieldId = table.fields.find((f) => f.name === 'Title')?.id ?? '';
      const createdByField = await createField(table.id, {
        type: 'createdBy',
        name: 'Created By',
      });
      const lastModifiedByField = await createField(table.id, {
        type: 'lastModifiedBy',
        name: 'Last Modified By',
      });

      const result = await createRecords(table.id, [
        {
          fields: {
            [titleFieldId]: 'first',
          },
        },
      ]);
      if (!Array.isArray(result)) {
        throw new Error(`Create records failed: ${JSON.stringify(result)}`);
      }
      const [createdRecord] = result;

      await updateRecord(table.id, createdRecord.id, {
        [titleFieldId]: 'updated',
      });

      const updated = await getRecordById(table.id, createdRecord.id);

      expect(updated.fields[createdByField.id]).toMatchObject({
        title: ctx.testUser.name,
        email: ctx.testUser.email,
      });
      expect(updated.fields[lastModifiedByField.id]).toMatchObject({
        title: ctx.testUser.name,
        email: ctx.testUser.email,
      });
    });
  });

  describe('avatar URL portability', () => {
    it('does not persist avatar URLs and normalizes legacy values at read time', async () => {
      const previousPublicUrl = process.env.BACKEND_STORAGE_PUBLIC_URL;
      vi.stubEnv('BACKEND_STORAGE_PUBLIC_URL', 'https://example.com/public');
      try {
        const table = await createTable({
          baseId: ctx.baseId,
          name: uniqueTableName('avatar-portability'),
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            { type: 'user', name: 'Single User', options: { isMultiple: false } },
            { type: 'user', name: 'Multiple Users', options: { isMultiple: true } },
            { type: 'createdBy', name: 'Created By' },
            { type: 'lastModifiedBy', name: 'Last Modified By' },
          ],
        });
        const field = (name: string) => table.fields.find((entry) => entry.name === name)!;
        const user = { id: ctx.testUser.id, title: ctx.testUser.name };
        const created = await createRecord(table.id, {
          [field('Title').id]: 'avatar row',
          [field('Single User').id]: user,
          [field('Multiple Users').id]: [user],
        });

        const expectedAvatarUrl = `https://example.com/public/avatar/${ctx.testUser.id}`;
        expect(created.fields[field('Single User').id]).toMatchObject({
          avatarUrl: expectedAvatarUrl,
        });
        expect(created.fields[field('Multiple Users').id]).toEqual([
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl }),
        ]);
        const listedAfterCreate = await listRecords(table.id, FieldKeyType.Name);
        expect(listedAfterCreate[0]?.fields['Single User']).toMatchObject({
          id: ctx.testUser.id,
          title: ctx.testUser.name,
          email: ctx.testUser.email,
          avatarUrl: expectedAvatarUrl,
        });
        expect(listedAfterCreate[0]?.fields['Multiple Users']).toEqual([
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl }),
        ]);
        expect(listedAfterCreate[0]?.fields['Created By']).toEqual(
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl })
        );

        const updated = await updateRecord(table.id, created.id, {
          [field('Title').id]: 'updated avatar row',
          [field('Single User').id]: user,
          [field('Multiple Users').id]: [user],
        });
        expect(updated.fields[field('Single User').id]).toMatchObject({
          avatarUrl: expectedAvatarUrl,
        });
        expect(updated.fields[field('Multiple Users').id]).toEqual([
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl }),
        ]);
        expect(updated.fields[field('Last Modified By').id]).toMatchObject({
          id: ctx.testUser.id,
          avatarUrl: expectedAvatarUrl,
        });
        const listedAfterUpdate = await listRecords(table.id, FieldKeyType.Name);
        expect(listedAfterUpdate[0]?.fields['Last Modified By']).toEqual(
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl })
        );

        const physical = await sql<{
          single: unknown;
          multiple: unknown;
          created: unknown;
          modified: unknown;
          version: number;
        }>`
          SELECT
            "__version" as version,
            ${sql.ref(field('Single User').dbFieldName!)} as single,
            ${sql.ref(field('Multiple Users').dbFieldName!)} as multiple,
            ${sql.ref(field('Created By').dbFieldName!)} as created,
            ${sql.ref(field('Last Modified By').dbFieldName!)} as modified
          FROM ${sql.table(`${ctx.baseId}.${table.id}`)}
          WHERE "__id" = ${created.id}
        `.execute(ctx.testContainer.db);
        const storedUser = {
          id: ctx.testUser.id,
          title: ctx.testUser.name,
          email: ctx.testUser.email,
        };
        expect.soft(physical.rows).toEqual([
          {
            single: storedUser,
            multiple: [storedUser],
            created: storedUser,
            modified: storedUser,
            version: expect.any(Number),
          },
        ]);

        const legacy = {
          id: ctx.testUser.id,
          title: ctx.testUser.name,
          email: ctx.testUser.email,
          avatarUrl: 'https://old.example.com/api/attachments/read/public/avatar/legacy',
        };
        await sql`
          UPDATE ${sql.table(`${ctx.baseId}.${table.id}`)}
          SET ${sql.ref(field('Multiple Users').dbFieldName!)} = ${JSON.stringify([legacy])}::jsonb,
              ${sql.ref(field('Created By').dbFieldName!)} = ${JSON.stringify(legacy)}::jsonb
          WHERE "__id" = ${created.id}
        `.execute(ctx.testContainer.db);

        const legacyList = await listRecords(table.id, FieldKeyType.Name);
        const legacyGet = await getRecordById(table.id, created.id);
        expect(legacyList[0]?.fields['Multiple Users']).toEqual([
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl }),
        ]);
        expect(legacyGet.fields[field('Multiple Users').id]).toEqual([
          expect.objectContaining({ id: ctx.testUser.id, avatarUrl: expectedAvatarUrl }),
        ]);
        const groupParams = new URLSearchParams({
          tableId: table.id,
          fieldKeyType: FieldKeyType.Id,
          groupBy: JSON.stringify([field('Created By').id]),
          includeGroups: 'true',
        });
        const groupedResponse = await fetch(`${ctx.baseUrl}/tables/listRecords?${groupParams}`);
        expect(groupedResponse.status).toBe(200);
        const grouped = listTableRecordsOkResponseSchema.parse(await groupedResponse.json());
        if (!grouped.ok) throw new Error('Grouped records request failed');
        expect(grouped.data.groups).toEqual([
          {
            count: 1,
            fields: { [field('Created By').id]: { ...storedUser, avatarUrl: expectedAvatarUrl } },
          },
        ]);
        const unchanged = await sql<{ multiple: unknown; version: number }>`
          SELECT ${sql.ref(field('Multiple Users').dbFieldName!)} as multiple, "__version" as version
          FROM ${sql.table(`${ctx.baseId}.${table.id}`)} WHERE "__id" = ${created.id}
        `.execute(ctx.testContainer.db);
        expect(JSON.stringify(unchanged.rows[0]?.multiple)).toContain('old.example.com');
        expect(unchanged.rows[0]?.version).toBe(physical.rows[0]?.version);
      } finally {
        vi.unstubAllEnvs();
        if (previousPublicUrl === undefined) delete process.env.BACKEND_STORAGE_PUBLIC_URL;
        else process.env.BACKEND_STORAGE_PUBLIC_URL = previousPublicUrl;
      }
    });

    it('backfills audit users without persisting avatar URLs', async () => {
      vi.stubEnv('BACKEND_STORAGE_PUBLIC_URL', 'https://backfill.example.com');
      try {
        const table = await createTable({
          baseId: ctx.baseId,
          name: uniqueTableName('audit-avatar-backfill'),
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        });
        const record = await createRecord(table.id, { [table.fields[0].id]: 'existing row' });
        const createdBy = await createField(table.id, { type: 'createdBy', name: 'Created By' });
        const modifiedBy = await createField(table.id, {
          type: 'lastModifiedBy',
          name: 'Modified By',
        });
        await ctx.drainOutbox();

        const storedUser = {
          id: ctx.testUser.id,
          title: ctx.testUser.name,
          email: ctx.testUser.email,
        };
        const stored = await sql<{ created: unknown; modified: unknown }>`
          SELECT ${sql.ref(createdBy.dbFieldName!)} as created,
                 ${sql.ref(modifiedBy.dbFieldName!)} as modified
          FROM ${sql.table(`${ctx.baseId}.${table.id}`)} WHERE "__id" = ${record.id}
        `.execute(ctx.testContainer.db);
        expect(stored.rows).toEqual([{ created: storedUser, modified: storedUser }]);

        const response = await getRecordById(table.id, record.id);
        const displayedUser = {
          ...storedUser,
          avatarUrl: `https://backfill.example.com/avatar/${ctx.testUser.id}`,
        };
        expect(response.fields[createdBy.id]).toEqual(displayedUser);
        expect(response.fields[modifiedBy.id]).toEqual(displayedUser);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it.each(['filter', 'records'] as const)(
      'keeps bulk %s user event values consistent without redundant member changes',
      async (mode) => {
        vi.stubEnv('BACKEND_STORAGE_PUBLIC_URL', 'https://bulk.example.com');
        try {
          const table = await createTable({
            baseId: ctx.baseId,
            name: uniqueTableName('bulk-avatar'),
            fields: [
              { type: 'singleLineText', name: 'Title', isPrimary: true },
              { type: 'user', name: 'Member', options: { isMultiple: false } },
            ],
          });
          const titleId = table.fields[0].id;
          const userId = table.fields.find((field) => field.name === 'Member')!.id;
          const user = { id: ctx.testUser.id, title: ctx.testUser.name };
          const record = await createRecord(table.id, { [titleId]: 'first', [userId]: user });
          const update = (fields: Record<string, unknown>) =>
            ctx.updateRecords(
              mode === 'filter'
                ? { tableId: table.id, fields, recordIds: [record.id] }
                : { tableId: table.id, records: [{ id: record.id, fields }] }
            );
          const changesSince = (offset: number) =>
            ctx.testContainer.eventBus
              .events()
              .slice(offset)
              .filter(
                (event): event is RecordsBatchUpdated =>
                  event instanceof RecordsBatchUpdated && event.tableId.toString() === table.id
              )
              .flatMap((event) => event.updates)
              .flatMap((update) => update.changes);

          let offset = ctx.testContainer.eventBus.events().length;
          await update({ [titleId]: 'second', [userId]: user });
          expect(changesSince(offset)).toContainEqual({
            fieldId: titleId,
            oldValue: 'first',
            newValue: 'second',
          });
          expect(changesSince(offset).some((change) => change.fieldId === userId)).toBe(false);

          offset = ctx.testContainer.eventBus.events().length;
          await update({ [userId]: null });
          expect(changesSince(offset)).toContainEqual({
            fieldId: userId,
            oldValue: {
              ...user,
              email: ctx.testUser.email,
              avatarUrl: `https://bulk.example.com/avatar/${ctx.testUser.id}`,
            },
            newValue: null,
          });
        } finally {
          vi.unstubAllEnvs();
        }
      }
    );
  });

  describe('record typecast compatibility', () => {
    it('prefills user field with resolved user info', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('user-prefill'),
        fields: [
          { type: 'singleLineText', name: 'title', isPrimary: true },
          {
            type: 'user',
            name: 'user',
            options: {
              isMultiple: false,
            },
          },
        ],
      });
      const userFieldId = table.fields.find((field) => field.name === 'user')?.id ?? '';

      await createRecords(table.id, [
        {
          fields: {
            [userFieldId]: {
              id: ctx.testUser.id,
              title: ctx.testUser.name,
            },
          },
        },
      ]);

      const records = await listRecords(table.id, FieldKeyType.Name);
      expect(records[0]?.fields.user).toEqual({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
        avatarUrl: expect.any(String),
      });
    });

    it('errors when user not in table', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('user-missing'),
        fields: [
          { type: 'singleLineText', name: 'title', isPrimary: true },
          {
            type: 'user',
            name: 'user',
            options: {
              isMultiple: false,
            },
          },
        ],
      });
      const userFieldId = table.fields.find((field) => field.name === 'user')?.id ?? '';

      const error = await createRecords(
        table.id,
        [
          {
            fields: {
              [userFieldId]: {
                id: 'not-in-table',
                title: 'not-in-table',
              },
            },
          },
        ],
        400
      );

      // @ts-expect-error infer error type
      expect(error.message).toContain('User(not-in-table) not found');
    });

    it('ignores wrong user name/email on input', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('user-sanitize'),
        fields: [
          { type: 'singleLineText', name: 'title', isPrimary: true },
          {
            type: 'user',
            name: 'user',
            options: {
              isMultiple: false,
            },
          },
        ],
      });
      const userFieldId = table.fields.find((field) => field.name === 'user')?.id ?? '';

      await createRecords(table.id, [
        {
          fields: {
            [userFieldId]: {
              id: ctx.testUser.id,
              title: '11111',
              email: '11111',
            },
          },
        },
      ]);

      const records = await listRecords(table.id, FieldKeyType.Name);
      expect(records[0]?.fields.user).toEqual({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
        email: ctx.testUser.email,
        avatarUrl: expect.any(String),
      });
    });

    it('prefills attachment field with stored attachment metadata', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('attachment-prefill'),
        fields: [
          { type: 'singleLineText', name: 'title', isPrimary: true },
          { type: 'attachment', name: 'attachment' },
        ],
      });
      const attachmentFieldId = table.fields.find((field) => field.name === 'attachment')?.id ?? '';

      await createRecords(table.id, [
        {
          fields: {
            [attachmentFieldId]: [
              {
                path: 'xxxxx',
                name: 'attachment',
                id: 'actattachment-id',
                size: 100,
                mimetype: 'text/plain',
                token: attachmentToken,
              },
            ],
          },
        },
      ]);

      const records = await listRecords(table.id, FieldKeyType.Id);
      expect(records[0]?.fields[attachmentFieldId]).toEqual([
        expect.objectContaining({
          token: attachmentToken,
          path: attachmentPath,
          size: attachmentSize,
          mimetype: attachmentMimetype,
          name: 'attachment',
        }),
      ]);
    });

    it('persists attachment rows into attachments_table on create and update', async () => {
      const initialAttachment = await seedAttachment();
      const replacementAttachment = await seedAttachment();
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('attachment-sync'),
        fields: [
          { type: 'singleLineText', name: 'title', isPrimary: true },
          { type: 'attachment', name: 'attachment' },
        ],
      });
      const titleFieldId = table.fields.find((field) => field.name === 'title')?.id ?? '';
      const attachmentFieldId = table.fields.find((field) => field.name === 'attachment')?.id ?? '';

      const createdRecord = await createRecord(table.id, {
        [titleFieldId]: 'attachment row sync',
        [attachmentFieldId]: [
          {
            id: 'act_sync_create_1',
            name: 'created.txt',
            token: initialAttachment.token,
            path: 'ignored/on/write',
            size: 1,
            mimetype: 'text/plain',
          },
        ],
      });

      const createdRows = await listAttachmentRows(createdRecord.id, attachmentFieldId);
      expect(createdRows).toEqual([
        {
          attachment_id: 'act_sync_create_1',
          token: initialAttachment.token,
          name: 'created.txt',
          table_id: table.id,
          record_id: createdRecord.id,
          field_id: attachmentFieldId,
        },
      ]);

      await updateRecord(table.id, createdRecord.id, {
        [attachmentFieldId]: [
          {
            id: 'act_sync_update_1',
            name: 'updated.txt',
            token: replacementAttachment.token,
            path: 'ignored/on/update',
            size: 2,
            mimetype: 'text/plain',
          },
        ],
      });

      const updatedRows = await listAttachmentRows(createdRecord.id, attachmentFieldId);
      expect(updatedRows).toEqual([
        {
          attachment_id: 'act_sync_update_1',
          token: replacementAttachment.token,
          name: 'updated.txt',
          table_id: table.id,
          record_id: createdRecord.id,
          field_id: attachmentFieldId,
        },
      ]);
    });

    it('errors when attachment token not exist', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('attachment-missing'),
        fields: [
          { type: 'singleLineText', name: 'title', isPrimary: true },
          { type: 'attachment', name: 'attachment' },
        ],
      });
      const attachmentFieldId = table.fields.find((field) => field.name === 'attachment')?.id ?? '';

      const error = await createRecords(
        table.id,
        [
          {
            fields: {
              [attachmentFieldId]: [
                {
                  path: 'table/unknown',
                  name: 'missing',
                  id: 'act-missing',
                  size: 1,
                  mimetype: 'text/plain',
                  token: 'not-exist-token',
                },
              ],
            },
          },
        ],
        400
      );

      // @ts-expect-error infer error type
      expect(error.message).toContain('Attachment(not-exist-token) not found');
    });

    it('updates record with user typecast values', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('user-typecast'),
        fields: [{ type: 'singleLineText', name: 'title', isPrimary: true }],
      });

      const singleUserField = await createField(table.id, {
        type: 'user',
        name: 'Single User',
        options: { isMultiple: false },
      });
      const multiUserField = await createField(table.id, {
        type: 'user',
        name: 'Multi User',
        options: { isMultiple: true },
      });
      const dateField = await createField(table.id, {
        type: 'date',
        name: 'Date Field',
      });

      const created = await createRecord(table.id, {
        [table.fields[0].id]: 'init',
      });

      const res1 = await updateRecord(
        table.id,
        created.id,
        {
          [singleUserField.id]: 'test',
        },
        true
      );

      const res2 = await updateRecord(
        table.id,
        created.id,
        {
          [multiUserField.id]: 'test@e2e.com',
        },
        true
      );

      const res3 = await updateRecord(
        table.id,
        created.id,
        {
          [dateField.id]: 'now',
        },
        true
      );

      expect(res1.fields[singleUserField.id]).toMatchObject({
        email: ctx.testUser.email,
        title: ctx.testUser.name,
      });
      expect(res2.fields[multiUserField.id]).toMatchObject([
        {
          email: ctx.testUser.email,
          title: ctx.testUser.name,
        },
      ]);

      expect(res3.fields[dateField.id]).toBeDefined();
    });
  });

  describe('record validation', () => {
    it('validates unique field values', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('unique-field'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      const uniqueField = await createField(table.id, {
        type: 'singleLineText',
        name: 'Unique Text',
        unique: true,
      });

      await createRecords(table.id, [
        {
          fields: {
            [uniqueField.id]: '100',
          },
        },
      ]);

      await createRecords(
        table.id,
        [
          {
            fields: {
              [uniqueField.id]: '100',
            },
          },
        ],
        400
      );

      await createRecords(table.id, [
        {
          fields: {
            [uniqueField.id]: '200',
          },
        },
      ]);
    });

    it('validates not-null field values', async () => {
      const table = await createTable({
        baseId: ctx.baseId,
        name: uniqueTableName('not-null-field'),
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      });
      await createField(table.id, {
        type: 'singleLineText',
        name: 'Required Text',
        notNull: true,
      });

      await createRecords(table.id, [{ fields: {} }], 400);
    });
  });
});
