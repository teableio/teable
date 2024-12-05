/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable/core';
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

describe('Trash (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;

  let awaitWithSpaceEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithBaseEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithTableEvent: <T>(fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    const appCtx = await initApp();

    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);

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
      await awaitWithTableEvent(() => deleteTable(baseId, tableId));

      const res = await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base });

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

      await awaitWithTableEvent(() => deleteTable(baseId, foreignTableId));

      const res = await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base });

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
      await awaitWithTableEvent(() => deleteTable(baseId, tableId));

      const trash = (await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base }))
        .data;
      const restored = await restoreTrash(trash.trashItems[0].id);

      expect(restored.status).toEqual(201);
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

      await awaitWithTableEvent(() => deleteTable(baseId, tableId1));
      await awaitWithTableEvent(() => deleteTable(baseId, tableId2));
      await awaitWithTableEvent(() => deleteTable(baseId, tableId3));

      const trash = (await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base }))
        .data;

      expect(trash.trashItems.length).toEqual(3);

      await resetTrashItems({ resourceType: ResourceType.Base, resourceId: baseId });

      const resetTrash = (
        await getTrashItems({ resourceId: baseId, resourceType: ResourceType.Base })
      ).data;

      expect(resetTrash.trashItems.length).toEqual(0);
    });
  });
});
