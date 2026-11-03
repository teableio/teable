/* eslint-disable sonarjs/no-duplicate-string */
import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITrashItemVo } from '@teable/openapi';
import {
  axios,
  getTrash,
  getTrashItems,
  resetTrashItems,
  restoreTrash,
  TrashType,
  trashVoSchema,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { DataDbHealthService } from '../src/features/space/data-db-health.service';
import { encryptDataDbUrl } from '../src/features/space/data-db-url-secret';
import { TrashService } from '../src/features/trash/trash.service';
import { DataDbClientManager } from '../src/global/data-db-client-manager.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  initApp,
  createSpace,
  createBase,
  permanentDeleteBase,
  permanentDeleteSpace,
  deleteSpace,
  deleteBase,
  deleteTable,
  createTable,
  createField,
} from './utils/init-app';

const isForceV2 = process.env.FORCE_V2_ALL === 'true';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForBaseTrashItems = async (baseId: string, expectedCount = 1, maxRetries = 100) => {
  for (let i = 0; i < maxRetries; i++) {
    const result = await getTrashItems({ resourceId: baseId, resourceType: TrashType.Base });
    if (result.data.trashItems.length >= expectedCount) {
      return result;
    }
    await sleep(100);
  }

  return await getTrashItems({ resourceId: baseId, resourceType: TrashType.Base });
};

const buildPostgresErrorResponse = (message: string) => {
  const fields = [
    Buffer.from('SFATAL\0'),
    Buffer.from('CXX000\0'),
    Buffer.from(`M${message}\0`),
    Buffer.from('\0'),
  ];
  const payload = Buffer.concat(fields);
  const response = Buffer.alloc(5 + payload.length);
  response[0] = 'E'.charCodeAt(0);
  response.writeInt32BE(4 + payload.length, 1);
  payload.copy(response, 5);
  return response;
};

const SSL_REQUEST_CODE = 80877103;

/**
 * A Supavisor pooler whose Supabase project has been deleted: every login is
 * rejected with "(ENOTFOUND) tenant/user postgres.<ref> not found".
 */
const createDeadSupavisor = async (
  tenantRef: string,
  message = `(ENOTFOUND) tenant/user postgres.${tenantRef} not found`
) => {
  const sockets = new Set<net.Socket>();
  let rejectedLogins = 0;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      if (chunk.length === 8 && chunk.readInt32BE(4) === SSL_REQUEST_CODE) {
        socket.write('N');
        return;
      }
      rejectedLogins += 1;
      socket.end(buildPostgresErrorResponse(message));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;

  return {
    url: `postgresql://postgres.${tenantRef}:secret@127.0.0.1:${port}/postgres`,
    rejectedLogins: () => rejectedLogins,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

describe('Trash (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;
  let prisma: PrismaService;

  let awaitWithSpaceEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithBaseEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithTableEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  const isBaseV2Mode = async (baseId: string) => {
    if (isForceV2) {
      return true;
    }

    const base = await prisma.base.findUnique({
      where: { id: baseId },
      select: { v2Enabled: true },
    });
    return Boolean(base?.v2Enabled);
  };

  const awaitWithTableDeleteSync = async <T>(baseId: string, fn: () => Promise<T>) =>
    (await isBaseV2Mode(baseId)) ? await fn() : awaitWithTableEvent(fn);

  beforeAll(async () => {
    const appCtx = await initApp();

    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
    prisma = app.get(PrismaService);

    awaitWithSpaceEvent = createAwaitWithEvent(eventEmitterService, Events.SPACE_DELETE);
    awaitWithBaseEvent = createAwaitWithEvent(eventEmitterService, Events.BASE_DELETE);
    awaitWithTableEvent = createAwaitWithEvent(eventEmitterService, Events.TABLE_DELETE);
  });

  afterAll(async () => {
    await app.close();
  });

  type RoutedDataClient = {
    $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<number>;
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
  };

  const insertVersionedArchive = async (
    client: RoutedDataClient,
    input: { taskId: string; baseId: string; seedTableId: string; recordId: string }
  ) => {
    const { taskId, baseId, seedTableId, recordId } = input;
    await client.$executeRawUnsafe(
      `insert into computed_update_dead_letter
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,failed_at,created_at,updated_at)
       values($1,'production',$2,$3,null,'update','[]'::jsonb,'[]'::jsonb,'dead',1,8,now(),1,$1,
         '{"rerunInputs":{"version":1,"complete":true,"seedCount":"1"}}'::jsonb,$1,
         array[$1],0,0,array[$3],array[]::text[],0,now(),now(),now())`,
      taskId,
      baseId,
      seedTableId
    );
    await client.$executeRawUnsafe(
      `insert into computed_update_dead_letter_seed(task_id,table_id,record_id)
       values($1,$2,$3)`,
      taskId,
      seedTableId,
      recordId
    );
  };

  const readArchiveFamilyCounts = async (
    client: RoutedDataClient,
    removedTaskIds: string[],
    retainedTaskIds: string[]
  ) => {
    const rows = await client.$queryRawUnsafe<
      Array<{
        removedArchives: number;
        removedChildren: number;
        retainedArchives: number;
        retainedChildren: number;
      }>
    >(
      `select
        (select count(*)::int from computed_update_dead_letter where id=any($1::text[])) as "removedArchives",
        (select count(*)::int from computed_update_dead_letter_seed where task_id=any($1::text[])) as "removedChildren",
        (select count(*)::int from computed_update_dead_letter where id=any($2::text[])) as "retainedArchives",
        (select count(*)::int from computed_update_dead_letter_seed where task_id=any($2::text[])) as "retainedChildren"`,
      removedTaskIds,
      retainedTaskIds
    );
    return rows[0];
  };

  const discardArchiveFixtures = async (client: RoutedDataClient, taskIds: string[]) => {
    await client.$queryRawUnsafe('select computed_outbox_discard_existing($1::text[])', taskIds);
  };

  const pendingPauseScopeId = (taskId: string) => `cup-pending-${taskId}`;

  const insertPendingOutboxTask = async (
    client: RoutedDataClient,
    input: { taskId: string; baseId: string; seedTableId: string }
  ) => {
    const { taskId, baseId, seedTableId } = input;
    // The orphan redrive makes a long-pending row due again. The active table pause
    // keeps this fixture unclaimable for the whole assertion window, so the test
    // observes the rows it inserted instead of a claim/redrive racing the check.
    await client.$executeRawUnsafe(
      `insert into computed_update_pause_scope (id, scope_type, scope_id, resume_at, updated_at)
       values ($1, 'table', $2, null, now())`,
      pendingPauseScopeId(taskId),
      seedTableId
    );
    await client.$executeRawUnsafe(
      `insert into computed_update_outbox
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,created_at,updated_at)
       values($1,'production',$2,$3,null,'update','[]'::jsonb,'[]'::jsonb,'pending',0,8,now() + interval '1 day',1,$1,
         '{}'::jsonb,$1,array[$1],0,0,array[$3],array[]::text[],0,now(),now())`,
      taskId,
      baseId,
      seedTableId
    );
    await client.$executeRawUnsafe(
      `insert into computed_update_outbox_seed(id,task_id,table_id,record_id)
       values($1,$2,$3,$4)`,
      `${taskId}-seed`,
      taskId,
      seedTableId,
      'rec-pending-seed'
    );
  };

  const readLiveOutboxCounts = async (
    client: RoutedDataClient,
    removedTaskIds: string[],
    retainedTaskIds: string[]
  ) => {
    const rows = await client.$queryRawUnsafe<
      Array<{
        removedTasks: number;
        removedSeeds: number;
        retainedTasks: number;
        retainedSeeds: number;
      }>
    >(
      `select
        (select count(*)::int from computed_update_outbox where id=any($1::text[])) as "removedTasks",
        (select count(*)::int from computed_update_outbox_seed where task_id=any($1::text[])) as "removedSeeds",
        (select count(*)::int from computed_update_outbox where id=any($2::text[])) as "retainedTasks",
        (select count(*)::int from computed_update_outbox_seed where task_id=any($2::text[])) as "retainedSeeds"`,
      removedTaskIds,
      retainedTaskIds
    );
    return rows[0];
  };

  const readPauseScopeCounts = async (
    client: RoutedDataClient,
    removedTableIds: string[],
    retainedTableIds: string[]
  ) => {
    const rows = await client.$queryRawUnsafe<
      Array<{ removedScopes: number; retainedScopes: number }>
    >(
      `select
        (select count(*)::int from computed_update_pause_scope
          where scope_type = 'table' and scope_id = any($1::text[])) as "removedScopes",
        (select count(*)::int from computed_update_pause_scope
          where scope_type = 'table' and scope_id = any($2::text[])) as "retainedScopes"`,
      removedTableIds,
      retainedTableIds
    );
    return rows[0];
  };

  const discardOutboxFixtures = async (client: RoutedDataClient, taskIds: string[]) => {
    await client.$executeRawUnsafe(
      'delete from computed_update_outbox where id=any($1::text[])',
      taskIds
    );
    // Remove only this fixture's pause rows. Pauses created by other tests or by the
    // product stay untouched, and this is still safe when the target purge, space
    // deletion or a retried cleanup already removed them.
    await client.$executeRawUnsafe(
      'delete from computed_update_pause_scope where id=any($1::text[])',
      taskIds.map(pendingPauseScopeId)
    );
  };

  describe('Retrieving trash items', () => {
    let spaceId: string;
    let baseId: string;

    beforeEach(async () => {
      spaceId = (await createSpace({})).id;
      baseId = (await createBase({ spaceId })).id;
    });

    afterEach(async () => {
      try {
        await permanentDeleteSpace(spaceId);
      } catch (e) {
        console.log('Space not found');
      }
    });

    it('should get trash for space', async () => {
      await awaitWithSpaceEvent(() => deleteSpace(spaceId));

      const res = await getTrash({ resourceType: TrashType.Space });

      expect(trashVoSchema.safeParse(res.data).success).toEqual(true);
    });

    it('should get trash for base', async () => {
      await awaitWithBaseEvent(() => deleteBase(baseId));

      const res = await getTrash({ resourceType: TrashType.Base });

      expect(trashVoSchema.safeParse(res.data).success).toEqual(true);
    });

    it('should retrieve trash items for base when a table is deleted', async () => {
      const tableId = (await createTable(baseId, {})).id;
      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, tableId));

      const res = await waitForBaseTrashItems(baseId, 1);

      expect(res.data.trashItems.length).toBe(1);
      expect((res.data.trashItems[0] as ITrashItemVo).resourceId).toBe(tableId);
    });

    it('should retrieve trash items for base when a linked foreign table is deleted', async () => {
      const mainTableId = (await createTable(baseId, {})).id;
      const foreignTableId = (await createTable(baseId, {})).id;

      await createField(mainTableId, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId,
        },
      });

      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, foreignTableId));

      const res = await waitForBaseTrashItems(baseId, 1);

      expect(res.data.trashItems.length).toBe(1);
      expect((res.data.trashItems[0] as ITrashItemVo).resourceId).toBe(foreignTableId);
    });
  });

  describe('Restoring trash items', () => {
    let spaceId: string;
    let baseId: string;
    let tableId: string;

    beforeEach(async () => {
      spaceId = (await createSpace({})).id;
      baseId = (await createBase({ spaceId })).id;
      tableId = (await createTable(baseId, {})).id;
    });

    afterEach(async () => {
      try {
        await permanentDeleteSpace(spaceId);
      } catch (e) {
        console.log('Space not found');
      }
    });

    it('should restore space successfully', async () => {
      await awaitWithSpaceEvent(() => deleteSpace(spaceId));

      const findTrash = async () =>
        (await getTrash({ resourceType: TrashType.Space })).data.trashItems.find(
          (item) => item.resourceId === spaceId
        );
      await expect.poll(findTrash).toBeDefined();
      const trash = await findTrash();
      if (!trash) throw new Error('space trash was not persisted');
      const restored = await restoreTrash(trash.id);

      expect(restored.status).toEqual(201);
    });

    it('should restore base successfully', async () => {
      await awaitWithBaseEvent(() => deleteBase(baseId));

      const findTrash = async () =>
        (await getTrash({ resourceType: TrashType.Base })).data.trashItems.find(
          (item) => item.resourceId === baseId
        );
      await expect.poll(findTrash).toBeDefined();
      const trash = await findTrash();
      if (!trash) throw new Error('base trash was not persisted');
      const restored = await restoreTrash(trash.id);

      expect(restored.status).toEqual(201);
    });

    it('should restore table successfully', async () => {
      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, tableId));

      const trash = (await waitForBaseTrashItems(baseId, 1)).data;
      const restored = await restoreTrash(trash.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });

    it('should expose restore-table canary headers when restoring a table trash item', async () => {
      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, tableId));

      const trash = (await waitForBaseTrashItems(baseId, 1)).data;
      const previousForceV2All = process.env.FORCE_V2_ALL;
      const restored = await (async () => {
        process.env.FORCE_V2_ALL = 'true';
        try {
          return await restoreTrash(trash.trashItems[0].id);
        } finally {
          if (previousForceV2All == null) {
            delete process.env.FORCE_V2_ALL;
          } else {
            process.env.FORCE_V2_ALL = previousForceV2All;
          }
        }
      })();

      expect(restored.status).toEqual(201);
      expect(restored.headers['x-teable-v2']).toBe('true');
      expect(restored.headers['x-teable-v2-feature']).toBe('restoreTable');
      expect(restored.headers['x-teable-v2-reason']).toBe('env_force_v2_all');
    });
  });

  describe('Reset trash items for base', () => {
    let spaceId: string;
    let baseId: string;

    beforeEach(async () => {
      spaceId = (await createSpace({})).id;
      baseId = (await createBase({ spaceId })).id;
    });

    afterEach(async () => {
      try {
        await permanentDeleteSpace(spaceId);
      } catch (e) {
        console.log('Space not found');
      }
    });

    it('should reset trash items successfully', async () => {
      const tableId1 = (await createTable(baseId, {})).id;
      const tableId2 = (await createTable(baseId, {})).id;
      const tableId3 = (await createTable(baseId, {})).id;

      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, tableId1));
      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, tableId2));
      await awaitWithTableDeleteSync(baseId, () => deleteTable(baseId, tableId3));

      const trash = (await waitForBaseTrashItems(baseId, 3)).data;

      expect(trash.trashItems.length).toEqual(3);

      await resetTrashItems({ resourceType: TrashType.Base, resourceId: baseId });

      const resetTrash = (await getTrashItems({ resourceId: baseId, resourceType: TrashType.Base }))
        .data;

      expect(resetTrash.trashItems.length).toEqual(0);
    });
  });

  describe('Versioned archive permanent deletion (real PostgreSQL)', () => {
    it('deletes only the archive family owned by the permanently deleted base', async () => {
      const space = await createSpace({ name: 'archive base deletion' });
      const deletedBase = await createBase({ spaceId: space.id, name: 'deleted archive base' });
      const retainedBase = await createBase({ spaceId: space.id, name: 'retained archive base' });
      const deletedTable = await createTable(deletedBase.id, { name: 'deleted archive table' });
      const retainedTable = await createTable(retainedBase.id, { name: 'retained archive table' });
      const deletedTaskId = `cuo${deletedTable.id.slice(3)}`;
      const retainedTaskId = `cuo${retainedTable.id.slice(3)}`;
      const deletedPendingTaskId = `cuo-pending-${deletedTable.id}`;
      const retainedPendingTaskId = `cuo-pending-${retainedTable.id}`;
      const dataClient = await app.get(DataDbClientManager).dataPrismaForBase(deletedBase.id);

      try {
        await insertVersionedArchive(dataClient, {
          taskId: deletedTaskId,
          baseId: deletedBase.id,
          seedTableId: deletedTable.id,
          recordId: 'rec-deleted-base',
        });
        await insertVersionedArchive(dataClient, {
          taskId: retainedTaskId,
          baseId: retainedBase.id,
          seedTableId: retainedTable.id,
          recordId: 'rec-retained-base',
        });
        await insertPendingOutboxTask(dataClient, {
          taskId: deletedPendingTaskId,
          baseId: deletedBase.id,
          seedTableId: deletedTable.id,
        });
        await insertPendingOutboxTask(dataClient, {
          taskId: retainedPendingTaskId,
          baseId: retainedBase.id,
          seedTableId: retainedTable.id,
        });

        await permanentDeleteBase(deletedBase.id);

        await expect(
          readArchiveFamilyCounts(dataClient, [deletedTaskId], [retainedTaskId])
        ).resolves.toEqual({
          removedArchives: 0,
          removedChildren: 0,
          retainedArchives: 1,
          retainedChildren: 1,
        });
        await expect(
          readLiveOutboxCounts(dataClient, [deletedPendingTaskId], [retainedPendingTaskId])
        ).resolves.toEqual({
          removedTasks: 0,
          removedSeeds: 0,
          retainedTasks: 1,
          retainedSeeds: 1,
        });
        await expect(
          readPauseScopeCounts(dataClient, [deletedTable.id], [retainedTable.id])
        ).resolves.toEqual({ removedScopes: 0, retainedScopes: 1 });
        await expect(
          dataClient.$queryRawUnsafe<Array<{ schemaName: string }>>(
            'select nspname as "schemaName" from pg_namespace where nspname=any($1::text[])',
            [deletedBase.id, retainedBase.id]
          )
        ).resolves.toEqual([{ schemaName: retainedBase.id }]);
        await expect(prisma.base.findUnique({ where: { id: deletedBase.id } })).resolves.toBeNull();
        await expect(
          prisma.base.findUnique({ where: { id: retainedBase.id } })
        ).resolves.not.toBeNull();
      } finally {
        await discardOutboxFixtures(dataClient, [
          deletedPendingTaskId,
          retainedPendingTaskId,
        ]).catch(() => undefined);
        await discardArchiveFixtures(dataClient, [deletedTaskId, retainedTaskId]).catch(
          () => undefined
        );
        for (const baseId of [deletedBase.id, retainedBase.id]) {
          if (await prisma.base.findUnique({ where: { id: baseId } })) {
            await permanentDeleteBase(baseId).catch(() => undefined);
          }
        }
        if (await prisma.space.findUnique({ where: { id: space.id } })) {
          await permanentDeleteSpace(space.id).catch(() => undefined);
        }
      }
    });

    it('deletes every archive family in a permanently deleted space and retains other spaces', async () => {
      const deletedSpace = await createSpace({ name: 'deleted archive space' });
      const retainedSpace = await createSpace({ name: 'retained archive space' });
      const firstDeletedBase = await createBase({
        spaceId: deletedSpace.id,
        name: 'first deleted archive base',
      });
      const secondDeletedBase = await createBase({
        spaceId: deletedSpace.id,
        name: 'second deleted archive base',
      });
      const retainedBase = await createBase({
        spaceId: retainedSpace.id,
        name: 'retained archive space base',
      });
      const firstDeletedTable = await createTable(firstDeletedBase.id, {
        name: 'first deleted archive table',
      });
      const secondDeletedTable = await createTable(secondDeletedBase.id, {
        name: 'second deleted archive table',
      });
      const retainedTable = await createTable(retainedBase.id, {
        name: 'retained archive space table',
      });
      const firstDeletedTaskId = `cuo${firstDeletedTable.id.slice(3)}`;
      const secondDeletedTaskId = `cuo${secondDeletedTable.id.slice(3)}`;
      const retainedTaskId = `cuo${retainedTable.id.slice(3)}`;
      const firstDeletedPendingTaskId = `cuo-pending-${firstDeletedTable.id}`;
      const secondDeletedPendingTaskId = `cuo-pending-${secondDeletedTable.id}`;
      const retainedPendingTaskId = `cuo-pending-${retainedTable.id}`;
      const dataClient = await app.get(DataDbClientManager).dataPrismaForBase(firstDeletedBase.id);

      try {
        for (const fixture of [
          {
            taskId: firstDeletedTaskId,
            baseId: firstDeletedBase.id,
            seedTableId: firstDeletedTable.id,
            recordId: 'rec-first-deleted-space',
          },
          {
            taskId: secondDeletedTaskId,
            baseId: secondDeletedBase.id,
            seedTableId: secondDeletedTable.id,
            recordId: 'rec-second-deleted-space',
          },
          {
            taskId: retainedTaskId,
            baseId: retainedBase.id,
            seedTableId: retainedTable.id,
            recordId: 'rec-retained-space',
          },
        ]) {
          await insertVersionedArchive(dataClient, fixture);
        }
        for (const fixture of [
          {
            taskId: firstDeletedPendingTaskId,
            baseId: firstDeletedBase.id,
            seedTableId: firstDeletedTable.id,
          },
          {
            taskId: secondDeletedPendingTaskId,
            baseId: secondDeletedBase.id,
            seedTableId: secondDeletedTable.id,
          },
          {
            taskId: retainedPendingTaskId,
            baseId: retainedBase.id,
            seedTableId: retainedTable.id,
          },
        ]) {
          await insertPendingOutboxTask(dataClient, fixture);
        }

        await permanentDeleteSpace(deletedSpace.id);

        await expect(
          readArchiveFamilyCounts(
            dataClient,
            [firstDeletedTaskId, secondDeletedTaskId],
            [retainedTaskId]
          )
        ).resolves.toEqual({
          removedArchives: 0,
          removedChildren: 0,
          retainedArchives: 1,
          retainedChildren: 1,
        });
        await expect(
          readLiveOutboxCounts(
            dataClient,
            [firstDeletedPendingTaskId, secondDeletedPendingTaskId],
            [retainedPendingTaskId]
          )
        ).resolves.toEqual({
          removedTasks: 0,
          removedSeeds: 0,
          retainedTasks: 1,
          retainedSeeds: 1,
        });
        await expect(
          readPauseScopeCounts(
            dataClient,
            [firstDeletedTable.id, secondDeletedTable.id],
            [retainedTable.id]
          )
        ).resolves.toEqual({ removedScopes: 0, retainedScopes: 1 });
        await expect(
          dataClient.$queryRawUnsafe<Array<{ schemaName: string }>>(
            'select nspname as "schemaName" from pg_namespace where nspname=any($1::text[])',
            [firstDeletedBase.id, secondDeletedBase.id, retainedBase.id]
          )
        ).resolves.toEqual([{ schemaName: retainedBase.id }]);
        await expect(
          prisma.space.findUnique({ where: { id: deletedSpace.id } })
        ).resolves.toBeNull();
        await expect(
          prisma.space.findUnique({ where: { id: retainedSpace.id } })
        ).resolves.not.toBeNull();
      } finally {
        await discardOutboxFixtures(dataClient, [
          firstDeletedPendingTaskId,
          secondDeletedPendingTaskId,
          retainedPendingTaskId,
        ]).catch(() => undefined);
        await discardArchiveFixtures(dataClient, [
          firstDeletedTaskId,
          secondDeletedTaskId,
          retainedTaskId,
        ]).catch(() => undefined);
        for (const spaceId of [deletedSpace.id, retainedSpace.id]) {
          if (await prisma.space.findUnique({ where: { id: spaceId } })) {
            await permanentDeleteSpace(spaceId).catch(() => undefined);
          }
        }
      }
    });
  });

  describe('Cleanup on a dead BYODB', () => {
    let deadDb: Awaited<ReturnType<typeof createDeadSupavisor>>;

    beforeAll(async () => {
      deadDb = await createDeadSupavisor('sztvxe2efake');
    });

    afterAll(async () => {
      await deadDb.close();
    });

    it('purges a table trash row even though every login to the bound DB fails', async () => {
      const space = await createSpace({ name: 'dead byodb space' });
      const base = await createBase({ spaceId: space.id, name: 'dead byodb base' });
      const table = await createTable(base.id, { name: 'victim table' });
      await deleteTable(base.id, table.id);

      // The TableTrashed listener writes the trash row asynchronously
      // (delete+insert replace), so poll until it lands.
      let trash: { id: string; parentId: string | null } | null = null;
      for (let i = 0; i < 100 && !trash; i++) {
        trash = await prisma.trash.findFirst({ where: { resourceId: table.id } });
        if (!trash) await sleep(100);
      }
      if (!trash) throw new Error('trash row for the deleted table never appeared');
      expect(trash.parentId).toBe(base.id);

      // Bind the space to the dead database only after the table exists on the
      // meta-fallback DB — mirrors production, where the customer's project
      // died after the tables were created.
      const connection = await prisma.dataDbConnection.create({
        data: {
          encryptedUrl: encryptDataDbUrl(deadDb.url),
          urlFingerprint: `dead-e2e-${Date.now()}`,
          internalSchema: '__teable_internal',
          status: 'ready',
          createdBy: 'e2e',
        },
      });
      await prisma.spaceDataDbBinding.create({
        data: {
          spaceId: space.id,
          dataDbConnectionId: connection.id,
          mode: 'byodb',
          state: 'ready',
          createdBy: 'e2e',
        },
      });

      // Same call the TrashCleanupProcessor makes.
      const trashService = app.get(TrashService);
      await trashService.delete(trash.id, true);

      expect(deadDb.rejectedLogins()).toBeGreaterThan(0);
      await expect(prisma.trash.findUnique({ where: { id: trash.id } })).resolves.toBeNull();
      await expect(prisma.tableMeta.findUnique({ where: { id: table.id } })).resolves.toBeNull();
    });
  });

  describe('Explicit BYODB space removal', () => {
    it.each([
      [
        'Supabase',
        '(EAUTHQUERY) authentication query failed: connection to database not available',
      ],
      [
        'Neon',
        'Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits.',
      ],
    ])(
      'requires explicit force to remove a space after %s rejects login',
      async (_provider, message) => {
        const deadDb = await createDeadSupavisor('force_removal_fixture', message);
        const space = await createSpace({ name: 'unreachable database space' });
        const sibling = await createSpace({ name: 'shared connection space' });
        const bases = await Promise.all([
          createBase({ spaceId: space.id, name: 'first base' }),
          createBase({ spaceId: space.id, name: 'second base' }),
        ]);
        const tables = await Promise.all(bases.map((base) => createTable(base.id, {})));
        const tableIds = tables.map((table) => table.id);
        const fieldIds = tables.flatMap((table) => table.fields.map((field) => field.id));
        let connectionId: string | undefined;
        try {
          await awaitWithSpaceEvent(() => deleteSpace(space.id));
          await expect
            .poll(() =>
              prisma.trash.findFirst({
                where: { resourceId: space.id, resourceType: TrashType.Space },
              })
            )
            .not.toBeNull();
          const trash = await prisma.trash.findFirstOrThrow({
            where: { resourceId: space.id, resourceType: TrashType.Space },
          });
          const connection = await prisma.dataDbConnection.create({
            data: {
              encryptedUrl: encryptDataDbUrl(deadDb.url),
              urlFingerprint: `force-removal-${space.id}`,
              internalSchema: '__teable_internal',
              status: 'ready',
              createdBy: 'e2e',
            },
          });
          connectionId = connection.id;
          await prisma.spaceDataDbBinding.createMany({
            data: [space.id, sibling.id].map((spaceId) => ({
              spaceId,
              dataDbConnectionId: connection.id,
              mode: 'byodb',
              state: 'ready',
              createdBy: 'e2e',
            })),
          });

          const listed = await getTrash({ resourceType: TrashType.Space });
          expect(listed.data.trashItems.find((item) => item.id === trash.id)).toMatchObject({
            isByodb: true,
          });

          const ordinary = await axios.delete(`/trash/${trash.id}`, {
            params: { force: false },
            validateStatus: () => true,
          });
          expect(ordinary.status).toBe(500);
          expect(deadDb.rejectedLogins()).toBeGreaterThan(0);
          await expect(
            prisma.space.findUnique({ where: { id: space.id } })
          ).resolves.not.toBeNull();
          await expect(
            prisma.trash.findUnique({ where: { id: trash.id } })
          ).resolves.not.toBeNull();
          // Automatic retention cleanup must retain the ordinary, strict policy.
          await expect(app.get(TrashService).delete(trash.id, true)).rejects.toThrow(message);

          const forced = await axios.delete(`/trash/${trash.id}`, {
            params: { force: true },
            validateStatus: () => true,
          });
          expect(forced.status).toBe(200);
          await expect(prisma.space.findUnique({ where: { id: space.id } })).resolves.toBeNull();
          await expect(
            prisma.spaceDataDbBinding.findUnique({ where: { spaceId: space.id } })
          ).resolves.toBeNull();
          await expect(prisma.base.count({ where: { spaceId: space.id } })).resolves.toBe(0);
          await expect(prisma.tableMeta.count({ where: { id: { in: tableIds } } })).resolves.toBe(
            0
          );
          await expect(prisma.field.count({ where: { id: { in: fieldIds } } })).resolves.toBe(0);
          await expect(prisma.view.count({ where: { tableId: { in: tableIds } } })).resolves.toBe(
            0
          );
          await expect(prisma.trash.findUnique({ where: { id: trash.id } })).resolves.toBeNull();
          await expect(
            prisma.space.findUnique({ where: { id: sibling.id } })
          ).resolves.not.toBeNull();
          await expect(
            prisma.spaceDataDbBinding.findUnique({ where: { spaceId: sibling.id } })
          ).resolves.toMatchObject({ dataDbConnectionId: connection.id });
          await expect(
            prisma.dataDbConnection.findUnique({ where: { id: connection.id } })
          ).resolves.not.toBeNull();
        } finally {
          await prisma.spaceDataDbBinding.deleteMany({
            where: { spaceId: { in: [space.id, sibling.id] } },
          });
          if (connectionId) {
            await app.get(DataDbClientManager).invalidateConnection(connectionId);
            await prisma.dataDbConnection.delete({ where: { id: connectionId } });
          }
          for (const id of [space.id, sibling.id]) {
            if (await prisma.space.findUnique({ where: { id } })) await permanentDeleteSpace(id);
          }
          // These fixtures start on the local default DB before their unavailable BYODB binding is added.
          for (const base of bases) {
            await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${base.id}" CASCADE`);
          }
          await deadDb.close();
        }
      }
    );

    it('rejects force removal of default spaces, bases and tables', async () => {
      const space = await createSpace({ name: 'default database space' });
      const base = await createBase({ spaceId: space.id });
      const table = await createTable(base.id, {});
      try {
        await deleteTable(base.id, table.id);
        await awaitWithBaseEvent(() => deleteBase(base.id));
        await awaitWithSpaceEvent(() => deleteSpace(space.id));
        const resourceIds = [space.id, base.id, table.id];
        await expect
          .poll(() =>
            prisma.trash.count({
              where: { resourceId: { in: resourceIds } },
            })
          )
          .toBe(3);
        const trashItems = await prisma.trash.findMany({
          where: { resourceId: { in: resourceIds } },
        });
        for (const item of trashItems) {
          const result = await axios.delete(`/trash/${item.id}`, {
            params: { force: true },
            validateStatus: () => true,
          });
          expect(result.status).toBe(400);
          await expect(prisma.trash.findUnique({ where: { id: item.id } })).resolves.not.toBeNull();
        }
        const listed = await getTrash({ resourceType: TrashType.Space });
        expect(
          listed.data.trashItems.find((item) => item.resourceId === space.id)
        ).not.toMatchObject({ isByodb: true });
      } finally {
        await permanentDeleteSpace(space.id);
      }
    });

    it('preserves authorization and migration freezes when removing a disabled read-only BYODB space', async () => {
      const space = await createSpace({ name: 'disabled database space' });
      const base = await createBase({ spaceId: space.id });
      const table = await createTable(base.id, {});
      const connection = await prisma.dataDbConnection.create({
        data: {
          encryptedUrl: encryptDataDbUrl('postgresql://unused:unused@127.0.0.1:1/unavailable'),
          urlFingerprint: `disabled-force-${space.id}`,
          internalSchema: '__teable_internal',
          status: 'disabled',
          createdBy: 'e2e',
        },
      });
      try {
        await awaitWithSpaceEvent(() => deleteSpace(space.id));
        await expect
          .poll(() => prisma.trash.findFirst({ where: { resourceId: space.id } }))
          .not.toBeNull();
        const trash = await prisma.trash.findFirstOrThrow({ where: { resourceId: space.id } });
        await prisma.spaceDataDbBinding.create({
          data: {
            spaceId: space.id,
            dataDbConnectionId: connection.id,
            mode: 'byodb',
            state: 'ready',
            createdBy: 'e2e',
          },
        });
        await app.get(DataDbHealthService).reportConnectionFailure({
          connectionId: connection.id,
          message: 'cannot execute INSERT in a read-only transaction',
        });
        await expect(app.get(DataDbHealthService).getHealthStateForSpace(space.id)).resolves.toBe(
          'read_only'
        );
        const outsider = await createNewUserAxios({
          email: 'force-removal-outsider@example.com',
          password: 'test-password-123',
        });
        const unauthorized = await outsider.delete(`/trash/${trash.id}`, {
          params: { force: true },
          validateStatus: () => true,
        });
        expect(unauthorized.status).toBe(403);
        await expect(prisma.space.findUnique({ where: { id: space.id } })).resolves.not.toBeNull();

        const job = await prisma.spaceDataDbMigrationJob.create({
          data: {
            spaceId: space.id,
            state: 'freezing_writes',
            switchOnCompletion: true,
            targetUrlFingerprint: `freeze-force-${space.id}`,
            targetInternalSchema: '__teable_internal',
            createdBy: 'e2e',
          },
        });
        const frozen = await axios.delete(`/trash/${trash.id}`, {
          params: { force: true },
          validateStatus: () => true,
        });
        expect(frozen.status).toBe(409);
        expect(frozen.data.data.errorCode).toBe('SPACE_DATA_DB_MIGRATING');
        await expect(
          prisma.spaceDataDbMigrationJob.findUnique({ where: { id: job.id } })
        ).resolves.not.toBeNull();
        await prisma.spaceDataDbMigrationJob.delete({ where: { id: job.id } });

        const forced = await axios.delete(`/trash/${trash.id}`, {
          params: { force: true },
          validateStatus: () => true,
        });
        expect(forced.status).toBe(200);
        await expect(prisma.space.findUnique({ where: { id: space.id } })).resolves.toBeNull();
        await expect(prisma.base.findUnique({ where: { id: base.id } })).resolves.toBeNull();
        await expect(prisma.tableMeta.findUnique({ where: { id: table.id } })).resolves.toBeNull();
      } finally {
        await prisma.spaceDataDbMigrationJob.deleteMany({ where: { spaceId: space.id } });
        await app.get(DataDbHealthService).reportConnectionRecovered(connection.id);
        await prisma.spaceDataDbBinding.deleteMany({ where: { spaceId: space.id } });
        await prisma.dataDbConnection.delete({ where: { id: connection.id } });
        if (await prisma.space.findUnique({ where: { id: space.id } }))
          await permanentDeleteSpace(space.id);
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${base.id}" CASCADE`);
      }
    });
  });
});
