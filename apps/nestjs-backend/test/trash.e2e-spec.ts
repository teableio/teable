/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITrashItemVo } from '@teable/openapi';
import {
  getTrash,
  getTrashItems,
  resetTrashItems,
  ResourceType,
  restoreTrash,
  trashVoSchema,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
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
    const result = await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base });
    if (result.data.trashItems.length >= expectedCount) {
      return result;
    }
    await sleep(100);
  }

  return await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base });
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

      const res = await getTrash({ resourceType: ResourceType.Space });

      expect(trashVoSchema.safeParse(res.data).success).toEqual(true);
    });

    it('should get trash for base', async () => {
      await awaitWithBaseEvent(() => deleteBase(baseId));

      const res = await getTrash({ resourceType: ResourceType.Base });

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

      const trash = (await getTrash({ resourceType: ResourceType.Space })).data;
      const restored = await restoreTrash(trash.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });

    it('should restore base successfully', async () => {
      await awaitWithBaseEvent(() => deleteBase(baseId));

      const trash = (await getTrash({ resourceType: ResourceType.Base })).data;
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
      expect(restored.headers['x-teable-v2-reason']).toBe('new_base');
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

      await resetTrashItems({ resourceType: ResourceType.Base, resourceId: baseId });

      const resetTrash = (
        await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base })
      ).data;

      expect(resetTrash.trashItems.length).toEqual(0);
    });
  });
});
