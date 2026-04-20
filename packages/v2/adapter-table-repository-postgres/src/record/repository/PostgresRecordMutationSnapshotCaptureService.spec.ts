import type { ILogger, ISpan, ITracer, SpanAttributes } from '@teable/v2-core';
import { sql, type Kysely } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPGliteDb } from '../../schema/visitors/__tests__/helpers/createPGliteDb';
import { installUndoCaptureGlobals } from '../../schema/visitors/__tests__/helpers/installUndoCaptureGlobals';
import { PostgresRecordMutationSnapshotCaptureService } from './PostgresRecordMutationSnapshotCaptureService';

class FakeSpan implements ISpan {
  ended = false;
  readonly errors: string[] = [];
  private readonly collectedAttributes: Record<string, string | number | boolean>;

  constructor(
    readonly name: string,
    readonly attributes?: SpanAttributes
  ) {
    this.collectedAttributes = (this.attributes ?? {}) as Record<string, string | number | boolean>;
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.setAttributes({ [key]: value });
  }

  setAttributes(attributes: SpanAttributes): void {
    Object.assign(this.collectedAttributes, attributes);
  }

  recordError(message: string): void {
    this.errors.push(message);
  }

  end(): void {
    this.ended = true;
  }
}

class FakeTracer implements ITracer {
  readonly spans: Array<{ name: string; attributes?: SpanAttributes; span: FakeSpan }> = [];
  private readonly activeSpans: FakeSpan[] = [];

  startSpan(name: string, attributes?: SpanAttributes): ISpan {
    const span = new FakeSpan(name, attributes ? { ...attributes } : undefined);
    this.spans.push({ name, attributes: span.attributes, span });
    return span;
  }

  async withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T> {
    this.activeSpans.push(span as FakeSpan);
    try {
      return await callback();
    } finally {
      this.activeSpans.pop();
    }
  }

  getActiveSpan(): ISpan | undefined {
    return this.activeSpans[this.activeSpans.length - 1];
  }
}

const createLogger = (): ILogger => {
  const logger: ILogger = {
    child: () => logger,
    scope: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

describe('PostgresRecordMutationSnapshotCaptureService', () => {
  let db: Kysely<unknown>;
  let closeDb: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const pgliteDb = await createPGliteDb();
    db = pgliteDb.db as unknown as Kysely<unknown>;
    closeDb = async () => {
      await pgliteDb.db.destroy();
    };

    await installUndoCaptureGlobals(db);

    await sql`
      CREATE TABLE "public"."test_capture" (
        "__id" TEXT PRIMARY KEY,
        "value" INTEGER NOT NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO "public"."test_capture" ("__id", "value")
      VALUES ('rec1', 1), ('rec2', 2)
    `.execute(db);
  });

  afterEach(async () => {
    await closeDb?.();
  });

  it('installs a batch_id index for __undo_log', async () => {
    const indexes = await sql<{ indexname: string }>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = '__undo_log'
      ORDER BY indexname
    `.execute(db);

    expect(indexes.rows.map((row) => row.indexname)).toContain('__undo_log_batch_id_idx');
  });

  it('installs storage tuning for __undo_log churn', async () => {
    const reloptionsResult = await sql<{ reloptions: string[] | null }>`
      SELECT reloptions
      FROM pg_class
      WHERE oid = 'public.__undo_log'::regclass
    `.execute(db);

    expect(reloptionsResult.rows[0]?.reloptions ?? []).toEqual(
      expect.arrayContaining([
        'autovacuum_vacuum_scale_factor=0.01',
        'autovacuum_vacuum_threshold=100',
      ])
    );

    const sequenceResult = await sql<{ seqcache: string | number }>`
      SELECT s.seqcache
      FROM pg_sequence s
      JOIN pg_class c ON c.oid = s.seqrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = '__undo_log_id_seq'
    `.execute(db);

    expect(Number(sequenceResult.rows[0]?.seqcache)).toBe(100);
  });

  it('emits named spans for ensure, begin, and finish', async () => {
    const tracer = new FakeTracer();
    const service = new PostgresRecordMutationSnapshotCaptureService(db as never, createLogger());

    await db.transaction().execute(async (trx) => {
      const session = (
        await service.begin({ tracer }, trx as never, 'public.test_capture')
      )._unsafeUnwrap();

      await sql`
        UPDATE "public"."test_capture"
        SET "value" = 11
        WHERE "__id" = 'rec1'
      `.execute(trx);

      const rows = (await session.finish())._unsafeUnwrap();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        operation: 'UPDATE',
        table_name: 'public.test_capture',
        record_id: 'rec1',
        old_row: { __id: 'rec1', value: 1 },
        new_row: { __id: 'rec1', value: 11 },
      });
    });

    expect(tracer.spans.map((span) => span.name)).toEqual([
      'teable.PostgresRecordMutationSnapshotCaptureService.begin',
      'teable.PostgresRecordMutationSnapshotCaptureService.ensureTable',
      'teable.PostgresRecordMutationSnapshotCaptureService.finish',
    ]);
    expect(tracer.spans[0]?.attributes).toMatchObject({
      'teable.undo_capture.phase': 'begin',
      'teable.table_name': 'public.test_capture',
    });
    expect(tracer.spans[1]?.attributes).toMatchObject({
      'teable.undo_capture.phase': 'ensureTable',
      'teable.table_name': 'public.test_capture',
    });
    expect(tracer.spans[2]?.attributes).toMatchObject({
      'teable.undo_capture.phase': 'finish',
      'teable.table_name': 'public.test_capture',
    });
    expect(tracer.spans.every((span) => span.span.ended)).toBe(true);
  });

  it('emits abort spans when a capture session is cancelled', async () => {
    const tracer = new FakeTracer();
    const service = new PostgresRecordMutationSnapshotCaptureService(db as never, createLogger());

    await db.transaction().execute(async (trx) => {
      const session = (
        await service.begin({ tracer }, trx as never, 'public.test_capture')
      )._unsafeUnwrap();

      await session.abort();
    });

    expect(tracer.spans.map((span) => span.name)).toEqual([
      'teable.PostgresRecordMutationSnapshotCaptureService.begin',
      'teable.PostgresRecordMutationSnapshotCaptureService.ensureTable',
      'teable.PostgresRecordMutationSnapshotCaptureService.abort',
    ]);
    expect(tracer.spans[2]?.attributes).toMatchObject({
      'teable.undo_capture.phase': 'abort',
      'teable.table_name': 'public.test_capture',
    });
    expect(tracer.spans.every((span) => span.span.ended)).toBe(true);
  });

  it('captures rows for schema-qualified tables', async () => {
    const tracer = new FakeTracer();
    const service = new PostgresRecordMutationSnapshotCaptureService(db as never, createLogger());

    await sql`CREATE SCHEMA "capture_schema"`.execute(db);
    await sql`
      CREATE TABLE "capture_schema"."test_capture" (
        "__id" TEXT PRIMARY KEY,
        "value" INTEGER NOT NULL
      )
    `.execute(db);
    await sql`
      INSERT INTO "capture_schema"."test_capture" ("__id", "value")
      VALUES ('rec_schema', 3)
    `.execute(db);

    await db.transaction().execute(async (trx) => {
      const session = (
        await service.begin({ tracer }, trx as never, 'capture_schema.test_capture')
      )._unsafeUnwrap();

      await sql`
        UPDATE "capture_schema"."test_capture"
        SET "value" = 4
        WHERE "__id" = 'rec_schema'
      `.execute(trx);

      const rows = (await session.finish())._unsafeUnwrap();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        operation: 'UPDATE',
        table_name: 'capture_schema.test_capture',
        record_id: 'rec_schema',
        old_row: { __id: 'rec_schema', value: 3 },
        new_row: { __id: 'rec_schema', value: 4 },
      });
    });
  });

  it('restores the previous batch id after a nested capture session finishes', async () => {
    const service = new PostgresRecordMutationSnapshotCaptureService(db as never, createLogger());

    await db.transaction().execute(async (trx) => {
      const outerSession = (
        await service.begin(undefined, trx as never, 'public.test_capture')
      )._unsafeUnwrap();

      await sql`
        UPDATE "public"."test_capture"
        SET "value" = 11
        WHERE "__id" = 'rec1'
      `.execute(trx);

      const innerSession = (
        await service.begin(undefined, trx as never, 'public.test_capture')
      )._unsafeUnwrap();

      await sql`
        UPDATE "public"."test_capture"
        SET "value" = 22
        WHERE "__id" = 'rec2'
      `.execute(trx);

      const innerRows = (await innerSession.finish())._unsafeUnwrap();
      expect(innerRows).toHaveLength(1);
      expect(innerRows[0]).toMatchObject({
        record_id: 'rec2',
        old_row: { __id: 'rec2', value: 2 },
        new_row: { __id: 'rec2', value: 22 },
      });

      await sql`
        UPDATE "public"."test_capture"
        SET "value" = 12
        WHERE "__id" = 'rec1'
      `.execute(trx);

      const outerRows = (await outerSession.finish())._unsafeUnwrap();
      expect(outerRows).toHaveLength(2);
      expect(outerRows.map((row) => row.record_id)).toEqual(['rec1', 'rec1']);
      expect(outerRows[0]).toMatchObject({
        old_row: { __id: 'rec1', value: 1 },
        new_row: { __id: 'rec1', value: 11 },
      });
      expect(outerRows[1]).toMatchObject({
        old_row: { __id: 'rec1', value: 11 },
        new_row: { __id: 'rec1', value: 12 },
      });
    });
  });

  it('re-installs capture wiring after a transaction rollback', async () => {
    const service = new PostgresRecordMutationSnapshotCaptureService(db as never, createLogger());

    await expect(
      db.transaction().execute(async (trx) => {
        const session = (
          await service.begin(undefined, trx as never, 'public.test_capture')
        )._unsafeUnwrap();

        await sql`
          UPDATE "public"."test_capture"
          SET "value" = 11
          WHERE "__id" = 'rec1'
        `.execute(trx);

        await session.abort();
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    await db.transaction().execute(async (trx) => {
      const session = (
        await service.begin(undefined, trx as never, 'public.test_capture')
      )._unsafeUnwrap();

      await sql`
        UPDATE "public"."test_capture"
        SET "value" = 13
        WHERE "__id" = 'rec1'
      `.execute(trx);

      const rows = (await session.finish())._unsafeUnwrap();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        operation: 'UPDATE',
        record_id: 'rec1',
        old_row: { __id: 'rec1', value: 1 },
        new_row: { __id: 'rec1', value: 13 },
      });
    });
  });

  it('fails begin when undo capture globals are missing', async () => {
    const missingDb = await createPGliteDb();
    const missingRootDb = missingDb.db as unknown as Kysely<unknown>;
    const service = new PostgresRecordMutationSnapshotCaptureService(
      missingRootDb as never,
      createLogger()
    );

    try {
      await sql`
        CREATE TABLE "public"."test_capture" (
          "__id" TEXT PRIMARY KEY,
          "value" INTEGER NOT NULL
        )
      `.execute(missingRootDb);

      const beginResult = await missingRootDb.transaction().execute(async (trx) => {
        return service.begin(undefined, trx as never, 'public.test_capture');
      });

      expect(beginResult.isErr()).toBe(true);
      expect(beginResult._unsafeUnwrapErr().message).toContain(
        '20260406000000_add_v2_undo_capture_infra'
      );
    } finally {
      await missingDb.db.destroy();
    }
  });
});
