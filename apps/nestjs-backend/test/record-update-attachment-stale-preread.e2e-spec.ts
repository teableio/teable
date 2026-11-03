import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, IAttachmentItem } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import {
  axios,
  getRecord,
  UPDATE_RECORD,
  X_CANARY_HEADER,
  uploadAttachment,
  urlBuilder,
} from '@teable/openapi';
import type { Knex } from 'knex';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';
import {
  createBase,
  createTable,
  deleteBase,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

const WAIT_TIMEOUT_MS = 15_000;

type HeldGate = {
  pid: number;
  release(): Promise<void>;
};

type GateNames = {
  functionName: string;
  triggerName: string;
  key: string;
};

type RecordUpdatedPayload = {
  recordId?: string;
  changes?: Array<{
    fieldId?: string;
    oldValue?: unknown;
    newValue?: unknown;
  }>;
};

const assertLocalPostgres = () => {
  const urls = [
    process.env.PRISMA_META_DATABASE_URL,
    process.env.PRISMA_DATABASE_URL,
    process.env.DATABASE_URL,
  ].filter((value): value is string => Boolean(value));
  if (!urls.length) {
    throw new Error('Attachment stale pre-read acceptance requires local PostgreSQL');
  }
  for (const value of urls) {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('Attachment stale pre-read acceptance only permits local PostgreSQL URLs');
    }
  }
};

const gateNames = (): GateNames => {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.toLowerCase();
  return {
    functionName: `attachment_stale_preread_${suffix}_fn`,
    triggerName: `attachment_stale_preread_${suffix}_trg`,
    key: `attachment-stale-preread:${suffix}`,
  };
};

const installGate = async (
  dataPrisma: DataPrismaService,
  knex: Knex,
  tableName: string,
  markerColumn: string,
  names: GateNames
): Promise<void> => {
  await dataPrisma.$executeRawUnsafe(
    knex
      .raw(
        `CREATE FUNCTION ??() RETURNS trigger
         LANGUAGE plpgsql AS $$
         BEGIN
           PERFORM pg_advisory_xact_lock(
             ('x' || substr(md5(TG_ARGV[0]), 1, 16))::bit(64)::bigint
           );
           RETURN NULL;
         END;
         $$`,
        [`public.${names.functionName}`]
      )
      .toQuery()
  );
  // updateRecord has completed its pre-read before this statement trigger fires. The trigger
  // takes no row lock, so the second writer can replace the attachment and commit first.
  await dataPrisma.$executeRawUnsafe(
    knex
      .raw(
        `CREATE TRIGGER ?? BEFORE UPDATE OF ?? ON ??
         FOR EACH STATEMENT EXECUTE FUNCTION ??(?)`,
        [names.triggerName, markerColumn, tableName, `public.${names.functionName}`, names.key]
      )
      .toQuery()
  );
};

const dropGate = async (
  dataPrisma: DataPrismaService,
  knex: Knex,
  tableName: string,
  names: GateNames
): Promise<void> => {
  await dataPrisma.$executeRawUnsafe(
    knex.raw('DROP TRIGGER IF EXISTS ?? ON ??', [names.triggerName, tableName]).toQuery()
  );
  await dataPrisma.$executeRawUnsafe(
    knex.raw('DROP FUNCTION IF EXISTS ??()', [`public.${names.functionName}`]).toQuery()
  );
};

const holdGate = async (knex: Knex, key: string): Promise<HeldGate> => {
  const acquired = Promise.withResolvers<number>();
  const release = Promise.withResolvers<void>();
  const transaction = knex.transaction(async (trx) => {
    const result = await trx.raw<{ rows: Array<{ pid: number }> }>(
      `SELECT pg_backend_pid()::int AS pid,
              pg_advisory_xact_lock(
                ('x' || substr(md5(?::text), 1, 16))::bit(64)::bigint
              )`,
      [key]
    );
    acquired.resolve(result.rows[0]!.pid);
    await release.promise;
  });
  void transaction.catch((error: unknown) => acquired.reject(error));

  let released = false;
  return {
    pid: await acquired.promise,
    release: async () => {
      if (!released) {
        released = true;
        release.resolve();
      }
      await transaction;
    },
  };
};

const waitForBlockedUpdate = async (
  dataPrisma: DataPrismaService,
  blockerPid: number
): Promise<void> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await dataPrisma.$queryRawUnsafe<Array<{ pid: number }>>(
      `SELECT pid::int AS pid
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND $1::int = ANY(pg_blocking_pids(pid))`,
      blockerPid
    );
    if (rows.length === 1) return;
    expect(rows, 'only the stale pre-read writer should wait on its unique gate').toHaveLength(0);
    await delay(20);
  }
  throw new Error('PostgreSQL did not observe the update after its stale pre-read');
};

const attachmentItems = (value: unknown): IAttachmentCellValue => {
  if (!Array.isArray(value)) throw new Error('Expected an attachment cell value');
  return value as IAttachmentCellValue;
};

const absoluteAttachmentUrl = (appUrl: string, item: IAttachmentItem): string => {
  if (!item.presignedUrl) throw new Error(`Attachment ${item.id} is missing its signed URL`);
  return item.presignedUrl.startsWith('http') ? item.presignedUrl : `${appUrl}${item.presignedUrl}`;
};

describe('V2 attachment stale pre-read events (real HTTP/PostgreSQL e2e)', () => {
  let app: INestApplication | undefined;
  let appUrl: string;
  let dataPrisma: DataPrismaService;
  let knex: Knex;

  beforeAll(async () => {
    assertLocalPostgres();
    ({ app, appUrl } = await initApp());
    dataPrisma = app.get(DataPrismaService);
    knex = app.get<Knex>('CUSTOM_KNEX');
    const database = await dataPrisma.$queryRawUnsafe<Array<{ version: string }>>(
      'SELECT version() AS version'
    );
    expect(database[0]?.version).toContain('PostgreSQL');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns and publishes signed A with before B when stale A is written back', async () => {
    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'T8242 attachment stale pre-read',
    });
    let tableId: string | undefined;
    let tableName: string | undefined;
    let gate: HeldGate | undefined;
    let names: GateNames | undefined;
    const requests: Array<Promise<unknown>> = [];

    try {
      const table = await createTable(base.id, {
        name: 'T8242 attachment stale pre-read',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
          { name: 'Marker', type: FieldType.SingleLineText },
          { name: 'Files', type: FieldType.Attachment },
        ],
        records: [
          { fields: { Name: 'target', Marker: 'initial' } },
          { fields: { Name: 'upload donor', Marker: 'donor' } },
        ],
      });
      tableId = table.id;
      tableName = table.dbTableName;
      const markerField = table.fields.find(({ name }) => name === 'Marker');
      const attachmentField = table.fields.find(({ name }) => name === 'Files');
      const target = table.records.find(({ fields }) => fields.Name === 'target');
      const donor = table.records.find(({ fields }) => fields.Name === 'upload donor');
      if (
        !markerField?.dbFieldName ||
        !attachmentField ||
        !target ||
        !donor ||
        !table.dbTableName
      ) {
        throw new Error('Incomplete attachment stale pre-read fixture');
      }

      // Both values come from the real multipart upload endpoint and real attachment storage.
      const uploadedA = await uploadAttachment(
        table.id,
        target.id,
        attachmentField.id,
        Buffer.from('attachment-a-body'),
        { filename: 'attachment-a.txt', contentType: 'text/plain' }
      );
      const attachmentA = attachmentItems(uploadedA.data.fields[attachmentField.id])[0]!;
      const uploadedB = await uploadAttachment(
        table.id,
        donor.id,
        attachmentField.id,
        Buffer.from('attachment-b-body'),
        { filename: 'attachment-b.txt', contentType: 'text/plain' }
      );
      const attachmentB = attachmentItems(uploadedB.data.fields[attachmentField.id])[0]!;
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, attachmentA))).text()).toBe(
        'attachment-a-body'
      );
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, attachmentB))).text()).toBe(
        'attachment-b-body'
      );

      names = gateNames();
      await installGate(dataPrisma, knex, table.dbTableName, markerField.dbFieldName, names);
      gate = await holdGate(knex, names.key);

      // T1 pre-reads A and asks for A again. Marker guarantees a statement reaches the gate while
      // the attachment assignment is equal according to that now-stale pre-read.
      const t1 = axios.patch(
        urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: target.id }),
        {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [markerField.id]: 'written by T1',
              [attachmentField.id]: [
                { id: attachmentA.id, name: attachmentA.name, token: attachmentA.token },
              ],
            },
          },
        },
        { headers: { [X_CANARY_HEADER]: 'true' } }
      );
      requests.push(t1);
      void Promise.allSettled(requests);
      await waitForBlockedUpdate(dataPrisma, gate.pid);

      // T2 commits B while T1 is parked after its pre-read. T1 must then authoritatively observe
      // B as OLD, write A back, and decorate A rather than leaking B's signed URL.
      const t2 = axios.patch(
        urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: target.id }),
        {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [attachmentField.id]: [
                { id: attachmentB.id, name: attachmentB.name, token: attachmentB.token },
              ],
            },
          },
        },
        { headers: { [X_CANARY_HEADER]: 'true' } }
      );
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Response = await t2;
      expect(t2Response.status).toBe(200);
      expect(t2Response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      const returnedB = attachmentItems(t2Response.data.fields[attachmentField.id])[0]!;
      expect(returnedB).toMatchObject({
        id: attachmentB.id,
        token: attachmentB.token,
        name: attachmentB.name,
        presignedUrl: expect.any(String),
      });

      await gate.release();
      const t1Response = await t1;
      expect(t1Response.status).toBe(200);
      expect(t1Response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      const returnedA = attachmentItems(t1Response.data.fields[attachmentField.id])[0]!;
      expect(returnedA).toMatchObject({
        id: attachmentA.id,
        token: attachmentA.token,
        name: attachmentA.name,
        presignedUrl: expect.any(String),
      });
      expect(returnedA.presignedUrl).not.toBe(returnedB.presignedUrl);
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, returnedA))).text()).toBe(
        'attachment-a-body'
      );

      const stored = await getRecord(table.id, target.id, { fieldKeyType: FieldKeyType.Id });
      const storedA = attachmentItems(stored.data.fields[attachmentField.id])[0]!;
      expect(storedA).toMatchObject({
        id: attachmentA.id,
        token: attachmentA.token,
        name: attachmentA.name,
        presignedUrl: expect.any(String),
      });
      expect(stored.data.fields[markerField.id]).toBe('written by T1');

      const eventRows = await dataPrisma.$queryRawUnsafe<Array<{ payload: unknown }>>(
        `SELECT payload
         FROM domain_event_outbox
         WHERE base_id = $1
           AND table_id = $2
           AND message_name = 'table.record.updated.v1'
         ORDER BY created_at, id`,
        base.id,
        table.id
      );
      const changes = eventRows.flatMap(({ payload }) => {
        const event = payload as RecordUpdatedPayload;
        return event.recordId === target.id ? (event.changes ?? []) : [];
      });
      const writeBack = changes.find((change) => {
        if (change.fieldId !== attachmentField.id) return false;
        const oldItems = Array.isArray(change.oldValue) ? change.oldValue : [];
        const newItems = Array.isArray(change.newValue) ? change.newValue : [];
        return (
          (oldItems[0] as { token?: unknown } | undefined)?.token === attachmentB.token &&
          (newItems[0] as { token?: unknown } | undefined)?.token === attachmentA.token
        );
      });
      expect(writeBack, 'missing authoritative B -> A RecordUpdated payload').toBeDefined();
      const eventBeforeB = attachmentItems(writeBack!.oldValue)[0]!;
      const eventAfterA = attachmentItems(writeBack!.newValue)[0]!;
      expect(eventBeforeB).toMatchObject({
        id: attachmentB.id,
        token: attachmentB.token,
        name: attachmentB.name,
      });
      expect(eventAfterA).toMatchObject({
        id: attachmentA.id,
        token: attachmentA.token,
        name: attachmentA.name,
        presignedUrl: returnedA.presignedUrl,
      });
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, eventAfterA))).text()).toBe(
        'attachment-a-body'
      );
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      if (tableName && names) await dropGate(dataPrisma, knex, tableName, names);
      try {
        if (tableId) await permanentDeleteTable(base.id, tableId);
      } finally {
        await deleteBase(base.id);
      }
    }
  }, 60_000);

  it('returns signed B and publishes only the marker change when stale A becomes an attachment no-op', async () => {
    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'T8242 mixed attachment no-op',
    });
    let tableId: string | undefined;
    let tableName: string | undefined;
    let gate: HeldGate | undefined;
    let names: GateNames | undefined;
    const requests: Array<Promise<unknown>> = [];

    try {
      const table = await createTable(base.id, {
        name: 'T8242 mixed attachment no-op',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
          { name: 'Marker', type: FieldType.SingleLineText },
          { name: 'Files', type: FieldType.Attachment },
        ],
        records: [
          { fields: { Name: 'target', Marker: 'initial' } },
          { fields: { Name: 'upload donor', Marker: 'donor' } },
        ],
      });
      tableId = table.id;
      tableName = table.dbTableName;
      const markerField = table.fields.find(({ name }) => name === 'Marker');
      const attachmentField = table.fields.find(({ name }) => name === 'Files');
      const target = table.records.find(({ fields }) => fields.Name === 'target');
      const donor = table.records.find(({ fields }) => fields.Name === 'upload donor');
      if (
        !markerField?.dbFieldName ||
        !attachmentField ||
        !target ||
        !donor ||
        !table.dbTableName
      ) {
        throw new Error('Incomplete mixed attachment no-op fixture');
      }

      const uploadedA = await uploadAttachment(
        table.id,
        target.id,
        attachmentField.id,
        Buffer.from('attachment-a-body'),
        { filename: 'attachment-a.txt', contentType: 'text/plain' }
      );
      const attachmentA = attachmentItems(uploadedA.data.fields[attachmentField.id])[0]!;
      const uploadedB = await uploadAttachment(
        table.id,
        donor.id,
        attachmentField.id,
        Buffer.from('attachment-b-body'),
        { filename: 'attachment-b.txt', contentType: 'text/plain' }
      );
      const attachmentB = attachmentItems(uploadedB.data.fields[attachmentField.id])[0]!;
      expect(attachmentA.token).not.toBe(attachmentB.token);

      const loadEvents = () =>
        dataPrisma.$queryRawUnsafe<Array<{ id: string; payload: RecordUpdatedPayload }>>(
          `SELECT id, payload
           FROM domain_event_outbox
           WHERE base_id = $1
             AND table_id = $2
             AND message_name = 'table.record.updated.v1'
           ORDER BY created_at, id`,
          base.id,
          table.id
        );

      names = gateNames();
      await installGate(dataPrisma, knex, table.dbTableName, markerField.dbFieldName, names);
      gate = await holdGate(knex, names.key);

      // T1 pre-reads A and requests B plus a real marker change. The statement-level gate
      // parks it after pre-read without locking the row, allowing T2 to commit B first.
      const t1 = axios.patch(
        urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: target.id }),
        {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [markerField.id]: 'written by T1',
              [attachmentField.id]: [
                { id: attachmentB.id, name: attachmentB.name, token: attachmentB.token },
              ],
            },
          },
        },
        { headers: { [X_CANARY_HEADER]: 'true' } }
      );
      requests.push(t1);
      void Promise.allSettled(requests);
      await waitForBlockedUpdate(dataPrisma, gate.pid);

      const t2 = axios.patch(
        urlBuilder(UPDATE_RECORD, { tableId: table.id, recordId: target.id }),
        {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [attachmentField.id]: [
                { id: attachmentB.id, name: attachmentB.name, token: attachmentB.token },
              ],
            },
          },
        },
        { headers: { [X_CANARY_HEADER]: 'true' } }
      );
      requests.push(t2);
      void Promise.allSettled(requests);
      const t2Response = await t2;
      expect(t2Response.status).toBe(200);
      expect(t2Response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(attachmentItems(t2Response.data.fields[attachmentField.id])).toEqual([
        expect.objectContaining({ id: attachmentB.id, token: attachmentB.token }),
      ]);

      // Prove event capture is live and isolate T1 from uploads and T2's genuine A -> B change.
      const beforeT1Events = await loadEvents();
      const t2AttachmentChange = beforeT1Events
        .filter(({ payload }) => payload.recordId === target.id)
        .flatMap(({ payload }) => payload.changes ?? [])
        .find(
          (change) =>
            change.fieldId === attachmentField.id &&
            Array.isArray(change.oldValue) &&
            Array.isArray(change.newValue) &&
            attachmentItems(change.oldValue)[0]?.token === attachmentA.token &&
            attachmentItems(change.newValue)[0]?.token === attachmentB.token
        );
      expect(t2AttachmentChange, 'missing genuine T2 A -> B attachment event').toBeDefined();
      const beforeT1EventIds = new Set(beforeT1Events.map(({ id }) => id));

      await gate.release();
      const t1Response = await t1;
      expect(t1Response.status).toBe(200);
      expect(t1Response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(t1Response.data.fields[markerField.id]).toBe('written by T1');
      const returnedItems = attachmentItems(t1Response.data.fields[attachmentField.id]);
      expect(returnedItems).toHaveLength(1);
      const returnedB = returnedItems[0]!;
      expect(returnedB).toMatchObject({
        id: attachmentB.id,
        token: attachmentB.token,
        name: attachmentB.name,
        presignedUrl: expect.any(String),
      });
      const download = await fetch(absoluteAttachmentUrl(appUrl, returnedB));
      expect(download.status).toBe(200);
      expect(await download.text()).toBe('attachment-b-body');

      const stored = await getRecord(table.id, target.id, { fieldKeyType: FieldKeyType.Id });
      expect(stored.data.fields[markerField.id]).toBe('written by T1');
      expect(attachmentItems(stored.data.fields[attachmentField.id])).toEqual([
        expect.objectContaining({
          id: attachmentB.id,
          token: attachmentB.token,
          name: attachmentB.name,
          presignedUrl: expect.any(String),
        }),
      ]);

      const t1Events = (await loadEvents()).filter(
        ({ id, payload }) => !beforeT1EventIds.has(id) && payload.recordId === target.id
      );
      expect(t1Events).toHaveLength(1);
      expect(t1Events[0]!.payload.changes).toEqual([
        {
          fieldId: markerField.id,
          oldValue: 'initial',
          newValue: 'written by T1',
        },
      ]);
    } finally {
      await gate?.release();
      await Promise.allSettled(requests);
      if (tableName && names) await dropGate(dataPrisma, knex, tableName, names);
      try {
        if (tableId) await permanentDeleteTable(base.id, tableId);
      } finally {
        await deleteBase(base.id);
      }
    }
  }, 60_000);
});
