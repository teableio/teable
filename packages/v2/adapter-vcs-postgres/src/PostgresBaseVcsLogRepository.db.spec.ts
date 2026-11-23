import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createV2PostgresDb,
  PostgresUnitOfWork,
  resolvePostgresDbOrTx,
} from '@teable/v2-adapter-db-postgres-pg';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  BaseId,
  v2CoreTokens,
  type IExecutionContext,
  type IUnitOfWork,
} from '@teable/v2-core';
import { computeVcsTableScopeTag, isValidPgSnapshotText } from '@teable/v2-vcs';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PostgresBaseVcsLogRepository,
  type IBaseVcsDatabase,
} from './PostgresBaseVcsLogRepository';

const createContext = (actor = 'usr_test'): IExecutionContext => ({
  actorId: ActorId.create(actor)._unsafeUnwrap(),
});

const MIGRATION_SQL_PATH = resolve(
  __dirname,
  '../../../db-main-prisma/prisma/postgres/migrations/20261118100000_add_base_vcs_tables/migration.sql'
);

const FULL_ZERO_SUMMARY = {
  tablesAdded: 0,
  tablesDeleted: 0,
  tablesRenamed: 0,
  fieldsAdded: 0,
  fieldsUpdated: 0,
  fieldsDeleted: 0,
  viewsAdded: 0,
  viewsUpdated: 0,
  viewsDeleted: 0,
  recordsAdded: 1,
  recordsUpdated: 0,
  recordsDeleted: 0,
  cellChanges: 0,
} as const;

describe('PostgresBaseVcsLogRepository (real PostgreSQL)', () => {
  let testContainer: IV2NodeTestContainer;
  let dataDb: Kysely<IBaseVcsDatabase>;
  let unitOfWork: IUnitOfWork;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer({ ensureSchema: true });
    dataDb = testContainer.dataDb as unknown as Kysely<IBaseVcsDatabase>;
    unitOfWork = testContainer.container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
  }, 120_000);

  afterAll(async () => {
    await testContainer?.dispose();
  }, 30_000);

  it('never caches enabled=false, rejects transactional enable(), and defaults storeChangePayloads=false', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const ctx = createContext();

    const repoA = new PostgresBaseVcsLogRepository(
      dataDb,
      unitOfWork,
      testContainer.metaDb as unknown as Kysely<unknown>
    );
    const repoB = new PostgresBaseVcsLogRepository(
      dataDb,
      unitOfWork,
      testContainer.metaDb as unknown as Kysely<unknown>
    );
    const repoWithPayloads = new PostgresBaseVcsLogRepository(
      dataDb,
      unitOfWork,
      testContainer.metaDb as unknown as Kysely<unknown>,
      undefined,
      undefined,
      { storeChangePayloads: true }
    );

    // 1. Neither instance caches `false`.
    expect((await repoB.isEnabled(ctx, baseId))._unsafeUnwrap()).toBe(false);

    // 2. Calling enable() inside an active data UoW tx rejects with vcs.enable_requires_autocommit.
    const txEnableRes = await unitOfWork.withTransaction(
      ctx,
      async (txCtx) => repoA.enable(txCtx, baseId),
      { scope: 'data' }
    );
    expect(txEnableRes.isErr()).toBe(true);
    expect(txEnableRes._unsafeUnwrapErr().code).toBe('vcs.enable_requires_autocommit');
    expect((await repoA.isEnabled(ctx, baseId))._unsafeUnwrap()).toBe(false);
    expect((await repoB.isEnabled(ctx, baseId))._unsafeUnwrap()).toBe(false);

    // 3. Committed enable on repoA becomes immediately visible to repoB.
    const enableRes = (await repoA.enable(ctx, baseId))._unsafeUnwrap();
    expect(enableRes.enabledAtRevision).toBe(0);
    expect((await repoB.isEnabled(ctx, baseId))._unsafeUnwrap()).toBe(true);

    // 4. Default storeChangePayloads=false omits JSONB values, while opt-in true stores them.
    const cursorBefore = (await repoB.capturePullCursor(ctx, baseId))._unsafeUnwrap();
    expect(cursorBefore.v).toBe(2);
    expect(cursorBefore.scopeTag).toBe('all');
    expect(isValidPgSnapshotText(cursorBefore.snapshot)).not.toBeNull();

    (
      await unitOfWork.withTransaction(
        ctx,
        async (txCtx) =>
          repoB.appendChanges(txCtx, baseId, [
            {
              tableId: 'tbl_cache_test',
              entityType: 'record',
              entityId: 'rec_cache_1',
              opKind: 'create',
              afterValue: { fld1: 'hello' },
              actorId: 'usr_test',
            },
          ]),
        { scope: 'data' }
      )
    )._unsafeUnwrap();

    (
      await unitOfWork.withTransaction(
        ctx,
        async (txCtx) =>
          repoWithPayloads.appendChanges(txCtx, baseId, [
            {
              tableId: 'tbl_cache_test',
              entityType: 'record',
              entityId: 'rec_payload_1',
              opKind: 'create',
              afterValue: { fld1: 'saved_payload' },
              actorId: 'usr_test',
            },
          ]),
        { scope: 'data' }
      )
    )._unsafeUnwrap();

    const page = (await repoA.listChangesSince(ctx, baseId, cursorBefore, 100))._unsafeUnwrap();
    expect(page.requiresFullSync).toBe(false);
    expect(page.hasMore).toBe(false);
    expect(page.changes.map((c) => c.entityId)).toEqual(['rec_cache_1', 'rec_payload_1']);
    expect(page.changes[0]?.beforeValue).toBeNull();
    expect(page.changes[0]?.afterValue).toBeNull();
    expect(page.changes[1]?.afterValue).toBeNull();

    const payloadPage = (
      await repoWithPayloads.listChangesSince(ctx, baseId, cursorBefore, 100)
    )._unsafeUnwrap();
    expect(payloadPage.changes.map((c) => c.entityId)).toEqual(['rec_cache_1', 'rec_payload_1']);
    expect(payloadPage.changes[0]?.afterValue).toBeNull();
    expect(payloadPage.changes[1]?.afterValue).toEqual({ fld1: 'saved_payload' });
  });

  it('stays immune to long-running transactions pinning xmin via native pg_snapshot visibility', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const ctx = createContext();
    const repo = new PostgresBaseVcsLogRepository(
      dataDb,
      unitOfWork,
      testContainer.metaDb as unknown as Kysely<unknown>
    );

    (await repo.enable(ctx, baseId))._unsafeUnwrap();

    (
      await unitOfWork.withTransaction(
        ctx,
        async (txCtx) =>
          repo.appendChanges(txCtx, baseId, [
            {
              tableId: 'tbl_pinned',
              entityType: 'record',
              entityId: 'rec_baseline',
              opKind: 'create',
              actorId: 'usr_test',
            },
          ]),
        { scope: 'data' }
      )
    )._unsafeUnwrap();

    const cursorAtBaseline = (await repo.capturePullCursor(ctx, baseId))._unsafeUnwrap();
    expect(cursorAtBaseline.maxSeq).toBeGreaterThan(0);

    // Pin PostgreSQL `xmin` via an open uncommitted transaction holding an assigned xid8.
    let releaseLongTx!: () => void;
    const longTxGate = new Promise<void>((resolveGate) => {
      releaseLongTx = resolveGate;
    });
    let markLongTxPinned!: () => void;
    const longTxPinned = new Promise<void>((resolvePinned) => {
      markLongTxPinned = resolvePinned;
    });
    const longTxPromise = dataDb.transaction().execute(async (trx) => {
      await sql`SELECT pg_current_xact_id()`.execute(trx);
      markLongTxPinned();
      await longTxGate;
    });

    try {
      await longTxPinned;

      // Commit 12 separate change transactions while xmin remains pinned by the long tx.
      for (let i = 1; i <= 12; i += 1) {
        (
          await unitOfWork.withTransaction(
            ctx,
            async (txCtx) =>
              repo.appendChanges(txCtx, baseId, [
                {
                  tableId: 'tbl_pinned',
                  entityType: 'record',
                  entityId: `rec_${i}`,
                  opKind: 'create',
                  actorId: 'usr_test',
                },
              ]),
            { scope: 'data' }
          )
        )._unsafeUnwrap();
      }

      // Even BEFORE the pinning tx ends, native pg_snapshot visibility avoids spurious full sync!
      const pinnedPull = (
        await repo.listChangesSince(ctx, baseId, cursorAtBaseline, 100)
      )._unsafeUnwrap();
      expect(pinnedPull.requiresFullSync).toBe(false);
      expect(pinnedPull.hasMore).toBe(false);
      expect(pinnedPull.changes.map((c) => c.entityId)).toEqual(
        Array.from({ length: 12 }, (_, idx) => `rec_${idx + 1}`)
      );

      // Following up while pinned still yields zero duplicates and requiresFullSync=false.
      const followUp = (
        await repo.listChangesSince(ctx, baseId, pinnedPull.cursor, 100)
      )._unsafeUnwrap();
      expect(followUp.requiresFullSync).toBe(false);
      expect(followUp.changes).toEqual([]);
    } finally {
      releaseLongTx();
      await longTxPromise;
    }
  });

  it('paginates deterministically with hasMore and delivers out-of-order commits with zero duplicates', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const ctx = createContext();
    const repo = new PostgresBaseVcsLogRepository(
      dataDb,
      unitOfWork,
      testContainer.metaDb as unknown as Kysely<unknown>
    );

    (await repo.enable(ctx, baseId))._unsafeUnwrap();
    const cursor0 = (await repo.capturePullCursor(ctx, baseId))._unsafeUnwrap();

    // tx1 inserts lower seq FIRST and remains open across initial pull.
    let releaseTx1!: () => void;
    const tx1Gate = new Promise<void>((resolveGate) => {
      releaseTx1 = resolveGate;
    });
    let markTx1Inserted!: () => void;
    const tx1Inserted = new Promise<void>((resolveInserted) => {
      markTx1Inserted = resolveInserted;
    });
    const tx1Promise = dataDb.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO base_vcs_change (base_id, table_id, entity_type, entity_id, op_kind)
        VALUES (${baseId.toString()}, 'tbl_concurrent', 'record', 'rec_tx1_first_seq', 'create')
      `.execute(trx);
      markTx1Inserted();
      await tx1Gate;
    });

    try {
      await tx1Inserted;

      // tx2, tx3, tx4 commit higher seqs BEFORE tx1 commits.
      for (const recId of ['rec_tx2_a', 'rec_tx3_b', 'rec_tx4_c']) {
        await dataDb.transaction().execute(async (trx) => {
          await sql`
            INSERT INTO base_vcs_change (base_id, table_id, entity_type, entity_id, op_kind)
            VALUES (${baseId.toString()}, 'tbl_concurrent', 'record', ${recId}, 'create')
          `.execute(trx);
        });
      }

      // Page 1 (limit: 2) locks a 2-snapshot interval [cursor0.snapshot -> targetSnapshot] with hasMore=true.
      const page1 = (await repo.listChangesSince(ctx, baseId, cursor0, 2))._unsafeUnwrap();
      expect(page1.requiresFullSync).toBe(false);
      expect(page1.hasMore).toBe(true);
      expect(page1.changes.map((c) => c.entityId)).toEqual(['rec_tx2_a', 'rec_tx3_b']);
      expect(page1.cursor.snapshot).toBe(cursor0.snapshot);
      expect(page1.cursor.page?.targetSnapshot).toBeTruthy();

      // Now commit tx1 AND insert a newer tx5 AFTER targetSnapshot was captured on page 1.
      releaseTx1();
      await tx1Promise;
      await dataDb.transaction().execute(async (trx) => {
        await sql`
          INSERT INTO base_vcs_change (base_id, table_id, entity_type, entity_id, op_kind)
          VALUES (${baseId.toString()}, 'tbl_concurrent', 'record', 'rec_tx5_after', 'create')
        `.execute(trx);
      });

      // Page 2 finishes the pinned interval (only rec_tx4_c) and advances snapshot to targetSnapshot.
      const page2 = (await repo.listChangesSince(ctx, baseId, page1.cursor, 2))._unsafeUnwrap();
      expect(page2.requiresFullSync).toBe(false);
      expect(page2.hasMore).toBe(false);
      expect(page2.changes.map((c) => c.entityId)).toEqual(['rec_tx4_c']);
      expect(page2.cursor.page).toBeUndefined();

      // Page 3 catches tx1 (even though tx1.seq < tx4.seq!) and tx5 without duplicating tx2..tx4.
      const page3 = (await repo.listChangesSince(ctx, baseId, page2.cursor, 100))._unsafeUnwrap();
      expect(page3.requiresFullSync).toBe(false);
      expect(page3.hasMore).toBe(false);
      expect(page3.changes.map((c) => c.entityId)).toEqual(['rec_tx1_first_seq', 'rec_tx5_after']);
    } finally {
      releaseTx1();
      await tx1Promise.catch(() => undefined);
    }
  });

  it('requiresFullSync when requested tableIds scope changes or widens', async () => {
    const baseId = BaseId.generate()._unsafeUnwrap();
    const ctx = createContext();
    const repo = new PostgresBaseVcsLogRepository(
      dataDb,
      unitOfWork,
      testContainer.metaDb as unknown as Kysely<unknown>
    );

    (await repo.enable(ctx, baseId))._unsafeUnwrap();

    const narrowCursor = (
      await repo.capturePullCursor(ctx, baseId, { tableIds: ['tbl_alpha'] })
    )._unsafeUnwrap();
    expect(narrowCursor.scopeTag).toBe(computeVcsTableScopeTag(['tbl_alpha']));

    const sameScopePage = (
      await repo.listChangesSince(ctx, baseId, narrowCursor, 100, { tableIds: ['tbl_alpha'] })
    )._unsafeUnwrap();
    expect(sameScopePage.requiresFullSync).toBe(false);

    const widenedPage = (
      await repo.listChangesSince(ctx, baseId, narrowCursor, 100, {
        tableIds: ['tbl_alpha', 'tbl_beta'],
      })
    )._unsafeUnwrap();
    expect(widenedPage.requiresFullSync).toBe(true);
    expect(widenedPage.cursor.scopeTag).toBe(computeVcsTableScopeTag(['tbl_alpha', 'tbl_beta']));
  });

  it('works cleanly on Prisma migration SQL schema and enforces compaction retention boundaries', async () => {
    const schemaName = `vcs_mig_${randomUUID().replaceAll('-', '')}`;
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    const url = new URL(testContainer.connectionString);
    url.searchParams.set('options', `-c search_path=${schemaName}`);
    const schemaConnStr = url.toString();

    await sql`CREATE SCHEMA ${sql.id(schemaName)}`.execute(dataDb);
    const migDb = await createV2PostgresDb<IBaseVcsDatabase>({
      pg: { connectionString: schemaConnStr, schema: schemaName, pool: { max: 4 } },
    });

    try {
      const migUow = new PostgresUnitOfWork<unknown>(
        migDb as unknown as Kysely<unknown>,
        migDb as unknown as Kysely<unknown>,
        { pg: { connectionString: schemaConnStr, schema: schemaName } },
        { pg: { connectionString: schemaConnStr, schema: schemaName } }
      );
      const migRepo = new PostgresBaseVcsLogRepository(migDb, migUow);
      const baseId = BaseId.generate()._unsafeUnwrap();
      const ctx = createContext('usr_mig');

      // Older data databases must keep committing business writes before their VCS migration.
      expect((await migRepo.getHead(ctx, baseId))._unsafeUnwrap().enabled).toBe(false);
      await sql`CREATE TABLE business_write (value integer)`.execute(migDb);
      const write = await migUow.withTransaction(
        ctx,
        async (txCtx) => {
          // Match an older data DB with no public tracking tables on its search path.
          const tx = resolvePostgresDbOrTx(migDb, txCtx, 'data');
          await sql`SET LOCAL search_path TO ${sql.id(schemaName)}`.execute(tx);
          const enabled = await migRepo.isEnabled(txCtx, baseId);
          expect(enabled._unsafeUnwrap()).toBe(false);
          await sql`INSERT INTO business_write VALUES (42)`.execute(tx);
          return enabled;
        },
        { scope: 'data' }
      );
      expect(write._unsafeUnwrap()).toBe(false);
      expect((await sql`SELECT value FROM business_write`.execute(migDb)).rows).toEqual([
        { value: 42 },
      ]);

      await sql.raw(migrationSql).execute(migDb);
      expect((await migRepo.enable(ctx, baseId))._unsafeUnwrap().enabledAtRevision).toBe(0);
      expect((await migRepo.isEnabled(ctx, baseId))._unsafeUnwrap()).toBe(true);
      const c0 = (await migRepo.capturePullCursor(ctx, baseId))._unsafeUnwrap();

      // Insert an initial change inside its own UoW so a later cursor sits behind retention.
      (
        await migUow.withTransaction(
          ctx,
          async (txCtx) =>
            migRepo.appendChanges(txCtx, baseId, [
              {
                tableId: 'tbl_mig',
                entityType: 'record',
                entityId: 'rec_mig_pre',
                opKind: 'create',
                actorId: 'usr_mig',
              },
            ]),
          { scope: 'data' }
        )
      )._unsafeUnwrap();
      const staleCursorBeforeCompaction = (
        await migRepo.capturePullCursor(ctx, baseId)
      )._unsafeUnwrap();

      const pushCommit = (
        await migUow.withTransaction(
          ctx,
          async (txCtx) => {
            (
              await migRepo.lockPushMetadata(txCtx, baseId, {
                tableIds: [],
                fieldIds: [],
                viewIds: [],
              })
            )._unsafeUnwrap();
            (await migRepo.lockPushPhysicalTargets(txCtx, baseId, []))._unsafeUnwrap();
            (
              await migRepo.appendChanges(txCtx, baseId, [
                {
                  tableId: 'tbl_mig',
                  entityType: 'record',
                  entityId: 'rec_mig_1',
                  opKind: 'create',
                  actorId: 'usr_mig',
                },
                {
                  tableId: 'tbl_mig',
                  entityType: 'record',
                  entityId: 'rec_mig_2',
                  opKind: 'create',
                  actorId: 'usr_mig',
                },
              ])
            )._unsafeUnwrap();
            return migRepo.appendCommit(txCtx, baseId, {
              expectedHeadRevision: 0,
              originPushId: 'push_mig_1',
              actorId: 'usr_mig',
              summary: FULL_ZERO_SUMMARY,
            });
          },
          { scope: 'data' }
        )
      )._unsafeUnwrap();

      expect(pushCommit.revision).toBe(1);
      expect(pushCommit.originPushId).toBe('push_mig_1');

      const foundCommit = (
        await migRepo.findCommitByOriginPushId(ctx, baseId, 'push_mig_1')
      )._unsafeUnwrap();
      expect(foundCommit?.commitId).toBe(pushCommit.commitId);

      const page = (await migRepo.listChangesSince(ctx, baseId, c0, 100))._unsafeUnwrap();
      expect(page.headRevision).toBe(1);
      expect(page.originPushIds).toEqual(['push_mig_1', '__direct_write__']);
      expect(page.changes).toHaveLength(3);

      const pushOnlyPage = (
        await migRepo.listChangesSince(ctx, baseId, staleCursorBeforeCompaction, 100)
      )._unsafeUnwrap();
      expect(pushOnlyPage.originPushIds).toEqual(['push_mig_1']);
      expect(pushOnlyPage.changes.map((c) => c.entityId)).toEqual(['rec_mig_1', 'rec_mig_2']);

      // Compact with maxAgeMs=0 and maxRows=1 deletes the older settled rows and bumps minRetainedSeq.
      const compactRes = (
        await migRepo.compactChanges(ctx, baseId, { maxAgeMs: 0, maxRows: 1 })
      )._unsafeUnwrap();
      expect(compactRes.deletedCount).toBe(2);
      expect(compactRes.minRetainedSeq).toBeGreaterThan(staleCursorBeforeCompaction.maxSeq);

      // Stale cursor predating minRetainedSeq triggers requiresFullSync=true.
      const afterCompact = (
        await migRepo.listChangesSince(ctx, baseId, staleCursorBeforeCompaction, 100)
      )._unsafeUnwrap();
      expect(afterCompact.requiresFullSync).toBe(true);
    } finally {
      await migDb.destroy();
      await sql`DROP SCHEMA ${sql.id(schemaName)} CASCADE`.execute(dataDb);
    }
  });
});
