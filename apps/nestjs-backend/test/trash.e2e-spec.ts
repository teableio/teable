/* eslint-disable sonarjs/no-duplicate-string */
import net from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITrashItemVo } from '@teable/openapi';
import {
  getTrash,
  getTrashItems,
  resetTrashItems,
  restoreTrash,
  TrashType,
  trashVoSchema,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { encryptDataDbUrl } from '../src/features/space/data-db-url-secret';
import { TrashService } from '../src/features/trash/trash.service';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  initApp,
  createSpace,
  createBase,
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
const createDeadSupavisor = async (tenantRef: string) => {
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
      socket.end(
        buildPostgresErrorResponse(`(ENOTFOUND) tenant/user postgres.${tenantRef} not found`)
      );
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

      const trash = (await getTrash({ resourceType: TrashType.Space })).data;
      const restored = await restoreTrash(trash.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });

    it('should restore base successfully', async () => {
      await awaitWithBaseEvent(() => deleteBase(baseId));

      const trash = (await getTrash({ resourceType: TrashType.Base })).data;
      const restored = await restoreTrash(trash.trashItems[0].id);

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
});
