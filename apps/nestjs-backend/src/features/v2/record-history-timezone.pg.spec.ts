import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { FieldType as CoreFieldType } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { defaultPgPoolFactory, PgPoolRegistry } from '@teable/db-main-prisma';
import { bindUnitOfWorkTransaction } from '@teable/v2-core';
import { Kysely, PostgresDialect } from 'kysely';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { RecordHistoryColdReadService } from '../record-history-cold/record-history-cold-read.service';
import { V2RecordUpdatedHistoryProjection } from './v2-record-history.service';

// The normal required-PG CI job provides an isolated, officially migrated database.
// Local runs need an explicit owned override; never fall back to a developer URL implicitly.
const ownedUrl =
  process.env.RECORD_HISTORY_PG_URL ??
  process.env.RECORD_ACTOR_PG_URL ??
  (process.env.UNIT_POSTGRES_REQUIRED === '1' ? process.env.PRISMA_DATABASE_URL : undefined);
if (process.env.UNIT_POSTGRES_REQUIRED === '1' && !ownedUrl) {
  throw new Error('PRISMA_DATABASE_URL is required for the isolated record-history PostgreSQL job');
}
if (ownedUrl) {
  const url = new URL(ownedUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('Record-history PostgreSQL tests require an owned loopback database');
  }
}

const frozenEvent = new Date('2026-11-05T18:11:18.886+08:00');
const frozenIso = '2026-11-05T10:11:18.886Z';
const canonicalTimestampText = '2026-11-05 10:11:18.886';
const tableId = `tbltz${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const recordId = `rectz${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const fieldId = 'fldtzproof0000000001';

const selectField = {
  id: () => ({ equals: (other: { toString(): string }) => other.toString() === fieldId }),
  type: () => ({ toString: () => CoreFieldType.SingleLineText }),
  name: () => ({ toString: () => 'Timezone proof' }),
  computed: () => ({ toBoolean: () => false }),
  accept: (visitor: { visitSingleLineTextField(): unknown }) => visitor.visitSingleLineTextField(),
};

const boundTable = {
  getField: (predicate: (field: typeof selectField) => boolean) =>
    predicate(selectField)
      ? { isErr: () => false, isOk: () => true, value: selectField }
      : { isErr: () => true, isOk: () => false, error: { code: 'field.not_found' } },
};

describe.skipIf(!ownedUrl)(
  'record history frozen event instant under a non-UTC PostgreSQL session',
  () => {
    let pool: Pool;
    let schema: string;
    let dataPrisma: DataPrismaService;
    let registry: PgPoolRegistry;
    let restoreMetaEnv = false;

    const qualified = () => `"${schema.replaceAll('"', '""')}"."record_history"`;

    beforeAll(async () => {
      if (!ownedUrl)
        throw new Error('RECORD_HISTORY_PG_URL must name the owned official data schema');
      schema = new URL(ownedUrl).searchParams.get('schema') ?? 'public';
      pool = new Pool({
        connectionString: ownedUrl,
        max: 2,
        options: `-c search_path="${schema.replaceAll('"', '""')}"`,
      });
      const present = await pool.query<{ table: string | null; column: string | null }>(
        `SELECT to_regclass($1)::text AS "table",
              (SELECT attname FROM pg_attribute
                WHERE attrelid = to_regclass($1) AND attname = 'actor_type'
                  AND attnum > 0 AND NOT attisdropped) AS "column"`,
        [`${schema}.record_history`]
      );
      if (!present.rows[0]?.table || !present.rows[0]?.column) {
        throw new Error(
          `owned schema ${schema} must already contain record_history with actor attribution columns`
        );
      }
      // DataPrismaService reads the meta URL env at construction to decide whether the
      // data database is shared with metadata. The owned URL is the only one this test
      // may use, so supply it under that key when the runner has no meta URL at all.
      if (
        !['PRISMA_META_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL'].some(
          (key) => process.env[key]
        )
      ) {
        process.env.PRISMA_META_DATABASE_URL = ownedUrl;
        restoreMetaEnv = true;
      }
      registry = new PgPoolRegistry(defaultPgPoolFactory);
      const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
      dataPrisma = new DataPrismaService(
        cls as never,
        registry.acquire(ownedUrl, {
          max: 2,
          applicationName: 'app-platform-history-timezone-read',
        }),
        schema
      );
      await dataPrisma.$connect();
    });

    afterAll(async () => {
      if (!pool) return;
      await pool.query(`DELETE FROM ${qualified()} WHERE "table_id" = $1`, [tableId]);
      await pool.end();
      await dataPrisma?.onModuleDestroy();
      await registry?.onApplicationShutdown();
      if (restoreMetaEnv) delete process.env.PRISMA_META_DATABASE_URL;
    });

    it('persists the frozen instant as canonical UTC text and the existing read consumer returns it', async () => {
      const writerClient = await pool.connect();
      const borrowedClient = {
        query: writerClient.query.bind(writerClient),
        // This test owns BEGIN/COMMIT and releases the real client in finally.
        release: () => undefined,
      };
      const db = new Kysely({
        dialect: new PostgresDialect({
          pool: { connect: async () => borrowedClient, end: async () => undefined } as never,
        }),
      });
      const projection = new V2RecordUpdatedHistoryProjection(
        { getContainerForTable: vi.fn(), getContainer: vi.fn() } as never,
        { recordHistoryDisabled: false } as never,
        { getById: vi.fn() } as never,
        { emit: vi.fn() } as never
      );

      let committed = false;

      try {
        await writerClient.query('BEGIN');
        await writerClient.query(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
        await writerClient.query(`SET LOCAL TIME ZONE 'Asia/Singapore'`);
        const session = await writerClient.query<{ timeZone: string }>(
          `SELECT current_setting('TimeZone') AS "timeZone"`
        );
        expect(session.rows[0].timeZone).toBe('Asia/Singapore');

        const context = bindUnitOfWorkTransaction(
          {
            actorId: { toString: () => 'usr-executor' },
            initiator: { type: 'appUser', id: 'apu-stable-principal' },
            sameTxProjection: { eventId: 'evt-tz-proof', tables: new Map([[tableId, boundTable]]) },
          } as never,
          { kind: 'unitOfWorkTransaction', scope: 'data', db } as never
        );
        const written = await projection.handle(context, {
          source: 'user',
          occurredAt: { toDate: () => frozenEvent },
          tableId: { toString: () => tableId },
          recordId: { toString: () => recordId },
          changes: [{ fieldId, oldValue: 'before', newValue: 'after' }],
        } as never);
        expect(written.isOk()).toBe(true);

        const stored = await writerClient.query<{ createdTime: string; actorType: string | null }>(
          `SELECT "created_time"::text AS "createdTime", "actor_type" AS "actorType"
         FROM ${qualified()} WHERE "table_id" = $1`,
          [tableId]
        );
        expect(stored.rows).toEqual([
          { createdTime: canonicalTimestampText, actorType: 'appUser' },
        ]);

        await writerClient.query('COMMIT');
        committed = true;
      } finally {
        if (!committed) await writerClient.query('ROLLBACK').catch(() => undefined);
        await db.destroy();
        writerClient.release();
      }

      const reader = new RecordHistoryColdReadService(
        { dataPrismaForTable: async () => dataPrisma } as never,
        {
          listMonths: async () => [],
          readStatsCached: async () => undefined,
          listMonthParts: async () => [],
        } as never
      );

      // The window is one UTC day around the frozen instant: pg renders a Date
      // parameter with the runner's local offset, and the offset of a timestamp
      // comparison is ignored, so a tight instant boundary would test the runner's
      // timezone rather than the stored instant. The stored wall time is asserted
      // exactly through createdTime below, which is what the drift corrupted.
      const page = await reader.collectHistoryRows({
        tableId,
        recordId,
        startDate: '2026-11-05T00:00:00.000Z',
        endDate: '2026-11-05T23:59:59.999Z',
        shouldFilterByField: true,
        allowedFieldIds: [fieldId],
        limit: 20,
      });

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]).toMatchObject({
        recordId,
        fieldId,
        actorType: 'appUser',
        actorId: 'apu-stable-principal',
        createdBy: 'usr-executor',
      });
      expect(page.rows[0].createdTime.getTime() - frozenEvent.getTime()).toBe(0);
      expect(page.rows[0].createdTime.toISOString()).toBe(frozenIso);
    });
  }
);
