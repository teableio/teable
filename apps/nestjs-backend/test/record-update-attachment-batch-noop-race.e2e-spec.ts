import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type { IAttachmentCellValue, IAttachmentItem, IRecord } from '@teable/core';
import { FieldKeyType, FieldType } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import {
  axios,
  getRecord,
  OPERATION_UNDO,
  uploadAttachment,
  X_CANARY_HEADER,
  urlBuilder,
} from '@teable/openapi';
import type { Knex } from 'knex';
import { X_TEABLE_V2_HEADER } from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { X_TEABLE_UNDO_REDO_ENGINE_HEADER } from '../src/features/undo-redo/open-api/undo-redo.service';
import {
  createBase,
  createTable,
  deleteBase,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

const WAIT_TIMEOUT_MS = 15_000;
const WINDOW_ID_HEADER = 'X-Window-Id';

interface HeldGate {
  pid: number;
  release(): Promise<void>;
}

interface GateNames {
  functionName: string;
  triggerName: string;
  key: string;
}

interface BatchUpdatedPayload {
  updates?: Array<{
    recordId?: string;
    changes?: Array<{
      fieldId?: string;
      oldValue?: unknown;
      newValue?: unknown;
    }>;
  }>;
}

interface BatchEventRow {
  id: unknown;
  payload: unknown;
}

const assertLocalPostgres = () => {
  const urls = [
    process.env.PRISMA_META_DATABASE_URL,
    process.env.PRISMA_DATABASE_URL,
    process.env.DATABASE_URL,
  ].filter((value): value is string => Boolean(value));
  if (!urls.length) {
    throw new Error('Attachment batch no-op acceptance requires local PostgreSQL');
  }
  for (const value of urls) {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('Attachment batch no-op acceptance only permits local PostgreSQL URLs');
    }
  }
};

const gateNames = (): GateNames => {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`.toLowerCase();
  return {
    functionName: `attachment_batch_noop_${suffix}_fn`,
    triggerName: `attachment_batch_noop_${suffix}_trg`,
    key: `attachment-batch-noop:${suffix}`,
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
  // The batch path has finished its application-level pre-read before this statement trigger.
  // A same-value Marker assignment makes the statement observable without changing the outcome.
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

const waitForBlockedBatch = async (
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
    expect(rows, 'only the stale batch writer should wait on its unique gate').toHaveLength(0);
    await delay(20);
  }
  throw new Error('PostgreSQL did not observe the batch after its stale pre-read');
};

const attachmentItems = (value: unknown): IAttachmentCellValue => {
  if (!Array.isArray(value)) throw new Error('Expected an attachment cell value');
  return value as IAttachmentCellValue;
};

const absoluteAttachmentUrl = (appUrl: string, item: IAttachmentItem): string => {
  if (!item.presignedUrl) throw new Error(`Attachment ${item.id} is missing its signed URL`);
  return item.presignedUrl.startsWith('http') ? item.presignedUrl : `${appUrl}${item.presignedUrl}`;
};

const uploadMultipart = async (
  tableId: string,
  recordId: string,
  fieldId: string,
  body: string,
  filename: string
): Promise<IRecord> => {
  const response = await uploadAttachment(tableId, recordId, fieldId, Buffer.from(body), {
    filename,
    contentType: 'text/plain',
  });
  expect(response.status).toBe(201);
  return response.data;
};

const loadBatchEvents = async (
  dataPrisma: DataPrismaService,
  baseId: string,
  tableId: string
): Promise<BatchEventRow[]> =>
  dataPrisma.$queryRawUnsafe<BatchEventRow[]>(
    `SELECT id, payload
     FROM domain_event_outbox
     WHERE base_id = $1
       AND table_id = $2
       AND message_name = 'table.records.batch-updated.v1'
     ORDER BY created_at, id`,
    baseId,
    tableId
  );

describe('V2 attachment batch no-op race (real multipart/PostgreSQL e2e)', () => {
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

  it('returns authoritative signed B when the stale batch becomes a no-op, without another event or undo', async () => {
    const base = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'T8242 attachment batch no-op race',
    });
    let tableId: string | undefined;
    let tableName: string | undefined;
    let gate: HeldGate | undefined;
    let names: GateNames | undefined;
    const requests: Array<Promise<unknown>> = [];

    try {
      const table = await createTable(base.id, {
        name: 'T8242 attachment batch no-op race',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
          { name: 'Gate', type: FieldType.SingleLineText },
          { name: 'Marker', type: FieldType.SingleLineText },
          { name: 'Files', type: FieldType.Attachment },
        ],
        records: [
          { fields: { Name: 'target', Gate: 'unchanged', Marker: 'initial' } },
          { fields: { Name: 'upload donor', Gate: 'donor', Marker: 'donor' } },
        ],
      });
      tableId = table.id;
      tableName = table.dbTableName;
      const gateField = table.fields.find(({ name }) => name === 'Gate');
      const markerField = table.fields.find(({ name }) => name === 'Marker');
      const attachmentField = table.fields.find(({ name }) => name === 'Files');
      const target = table.records.find(({ fields }) => fields.Name === 'target');
      const donor = table.records.find(({ fields }) => fields.Name === 'upload donor');
      if (
        !gateField?.dbFieldName ||
        !markerField ||
        !attachmentField ||
        !target ||
        !donor ||
        !table.dbTableName
      ) {
        throw new Error('Incomplete attachment batch no-op fixture');
      }

      // Both attachment identities and their signed URLs originate from real multipart HTTP uploads.
      const uploadedA = await uploadMultipart(
        table.id,
        target.id,
        attachmentField.id,
        'attachment-a-body',
        'attachment-a.txt'
      );
      const attachmentA = attachmentItems(uploadedA.fields[attachmentField.id])[0]!;
      const uploadedB = await uploadMultipart(
        table.id,
        donor.id,
        attachmentField.id,
        'attachment-b-body',
        'attachment-b.txt'
      );
      const attachmentB = attachmentItems(uploadedB.fields[attachmentField.id])[0]!;
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, attachmentA))).text()).toBe(
        'attachment-a-body'
      );
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, attachmentB))).text()).toBe(
        'attachment-b-body'
      );

      names = gateNames();
      await installGate(dataPrisma, knex, table.dbTableName, gateField.dbFieldName, names);
      gate = await holdGate(knex, names.key);

      const staleWindowId = `win-batch-noop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const winnerWindowId = `win-batch-winner-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const attachmentBInput = [
        { id: attachmentB.id, name: attachmentB.name, token: attachmentB.token },
      ];

      // T1 pre-reads attachment A and resolves only Marker initial -> final. Its same-value Gate
      // assignment reaches the statement trigger without asking the response to contain B.
      const staleBatch = axios.patch<IRecord[]>(
        `/table/${table.id}/record`,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: target.id,
              fields: {
                [gateField.id]: 'unchanged',
                [markerField.id]: 'final',
              },
            },
          ],
        },
        {
          headers: {
            [X_CANARY_HEADER]: 'true',
            [WINDOW_ID_HEADER]: staleWindowId,
          },
        }
      );
      requests.push(staleBatch);
      void Promise.allSettled(requests);
      await waitForBlockedBatch(dataPrisma, gate.pid);

      // T2 commits Marker final and attachment B first without touching the gated column. When T1
      // resumes, its whole UPDATE is a no-op and its response must be materialized from SQL truth.
      const winnerBatch = axios.patch<IRecord[]>(
        `/table/${table.id}/record`,
        {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: target.id,
              fields: {
                [markerField.id]: 'final',
                [attachmentField.id]: attachmentBInput,
              },
            },
          ],
        },
        {
          headers: {
            [X_CANARY_HEADER]: 'true',
            [WINDOW_ID_HEADER]: winnerWindowId,
          },
        }
      );
      requests.push(winnerBatch);
      void Promise.allSettled(requests);
      const winnerResponse = await winnerBatch;
      expect(winnerResponse.status).toBe(200);
      expect(winnerResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(winnerResponse.data).toHaveLength(1);
      const winnerB = attachmentItems(winnerResponse.data[0]!.fields[attachmentField.id])[0]!;
      expect(winnerB).toMatchObject({
        id: attachmentB.id,
        token: attachmentB.token,
        name: attachmentB.name,
        presignedUrl: expect.any(String),
      });

      const eventsAfterWinner = await loadBatchEvents(dataPrisma, base.id, table.id);
      const winnerChanges = eventsAfterWinner
        .flatMap(({ payload }) => {
          const event = payload as BatchUpdatedPayload;
          return (event.updates ?? [])
            .filter((update) => update.recordId === target.id)
            .flatMap((update) => update.changes ?? []);
        })
        .filter(({ fieldId }) => fieldId === attachmentField.id);
      expect(
        winnerChanges,
        'the winning A -> B batch must prove event capture is active'
      ).toHaveLength(1);
      const eventIdsAfterWinner = new Set(eventsAfterWinner.map(({ id }) => String(id)));
      const versionQuery = knex(table.dbTableName)
        .select({ version: '__version' })
        .where('__id', target.id)
        .toQuery();
      const versionAfterWinner =
        await dataPrisma.$queryRawUnsafe<Array<{ version: unknown }>>(versionQuery);
      expect(versionAfterWinner).toHaveLength(1);

      await gate.release();
      const staleResponse = await staleBatch;
      expect(staleResponse.status).toBe(200);
      expect(staleResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(staleResponse.data).toHaveLength(1);
      const authoritativeB = attachmentItems(staleResponse.data[0]!.fields[attachmentField.id])[0]!;
      expect(authoritativeB).toMatchObject({
        id: attachmentB.id,
        token: attachmentB.token,
        name: attachmentB.name,
        presignedUrl: expect.any(String),
      });
      expect(authoritativeB.id).not.toBe(attachmentA.id);
      expect(await (await fetch(absoluteAttachmentUrl(appUrl, authoritativeB))).text()).toBe(
        'attachment-b-body'
      );

      const stored = await getRecord(table.id, target.id, { fieldKeyType: FieldKeyType.Id });
      const storedB = attachmentItems(stored.data.fields[attachmentField.id])[0]!;
      expect(storedB).toMatchObject({
        id: attachmentB.id,
        token: attachmentB.token,
        name: attachmentB.name,
        presignedUrl: expect.any(String),
      });
      expect(stored.data.fields[gateField.id]).toBe('unchanged');
      expect(stored.data.fields[markerField.id]).toBe('final');
      const versionAfterNoop =
        await dataPrisma.$queryRawUnsafe<Array<{ version: unknown }>>(versionQuery);
      expect(versionAfterNoop).toEqual(versionAfterWinner);

      const eventsAfterNoop = await loadBatchEvents(dataPrisma, base.id, table.id);
      const noopEvents = eventsAfterNoop.filter(({ id }) => !eventIdsAfterWinner.has(String(id)));
      expect(noopEvents, 'the SQL no-op must not publish a second batch event').toEqual([]);

      const undoResponse = await axios.post(
        urlBuilder(OPERATION_UNDO, { tableId: table.id }),
        undefined,
        {
          headers: {
            [X_CANARY_HEADER]: 'true',
            [WINDOW_ID_HEADER]: staleWindowId,
          },
        }
      );
      expect(undoResponse.status).toBe(201);
      expect(undoResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      // An empty v2 scope falls through to the empty legacy scope for response attribution only.
      expect(undoResponse.headers[X_TEABLE_UNDO_REDO_ENGINE_HEADER]).toBe('v1');
      expect(undoResponse.data).toMatchObject({ status: 'empty' });
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
