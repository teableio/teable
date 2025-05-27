/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import { FieldType, ViewType } from '@teable/core';
import type { ITableTrashItemVo } from '@teable/openapi';
import {
  deleteFields,
  deleteRecords,
  deleteView,
  getTrashItems,
  resetTrashItems,
  ResourceType,
  restoreTrash,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  initApp,
  createTable,
  permanentDeleteTable,
  getViews,
  getFields,
  getRecords,
  createField,
} from './utils/init-app';

const tableVo = {
  fields: [
    {
      name: 'SingleLineText',
      type: FieldType.SingleLineText,
    },
    {
      name: 'Number',
      type: FieldType.Number,
    },
    {
      name: 'Checkbox',
      type: FieldType.Checkbox,
    },
  ],
  views: [
    {
      name: 'Grid',
      type: ViewType.Grid,
    },
    {
      name: 'Gallery',
      type: ViewType.Gallery,
    },
  ],
  records: Array.from({ length: 10 }).map(() => ({
    fields: {
      SingleLineText: faker.lorem.words(),
      Number: faker.number.int(),
      Checkbox: true,
    },
  })),
};

describe('Trash (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;

  const baseId = globalThis.testConfig.baseId;

  let awaitWithViewEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithFieldEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithRecordEvent: <T>(fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    const appCtx = await initApp();

    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);

    awaitWithViewEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_VIEW_DELETE);
    awaitWithFieldEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_FIELDS_DELETE);
    awaitWithRecordEvent = createAwaitWithEvent(
      eventEmitterService,
      Events.OPERATION_RECORDS_DELETE
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Retrieving table trash items', () => {
    let tableId: string;

    beforeEach(async () => {
      tableId = (await createTable(baseId, tableVo)).id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableId);
    });

    it('should retrieve table trash items when a view is deleted', async () => {
      const views = await getViews(tableId);
      const deletedViewId = views[0].id;

      await awaitWithViewEvent(() => deleteView(tableId, deletedViewId));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });

      expect(result.data.trashItems.length).toBe(1);
      expect((result.data.trashItems[0] as ITableTrashItemVo).resourceIds[0]).toBe(deletedViewId);
    });

    it('should retrieve table trash items when fields are deleted', async () => {
      const fields = await getFields(tableId);
      const deletedFieldIds = fields.filter((f) => !f.isPrimary).map((f) => f.id);

      await awaitWithFieldEvent(async () => deleteFields(tableId, deletedFieldIds));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });

      expect(result.data.trashItems.length).toBe(1);
      expect((result.data.trashItems[0] as ITableTrashItemVo).resourceIds).toEqual(deletedFieldIds);
    });

    it('should retrieve table trash items when records are deleted', async () => {
      const recordsData = await getRecords(tableId);
      const deletedRecordIds = recordsData.records.map((r) => r.id);

      await awaitWithRecordEvent(() => deleteRecords(tableId, deletedRecordIds));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });

      expect(result.data.trashItems.length).toBe(1);
      expect((result.data.trashItems[0] as ITableTrashItemVo).resourceIds).toEqual(
        deletedRecordIds
      );
    });
  });

  describe('Restoring table trash items', () => {
    let tableId: string;

    beforeEach(async () => {
      tableId = (await createTable(baseId, tableVo)).id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableId);
    });

    it('should restore view successfully', async () => {
      const views = await getViews(tableId);
      const deletedViewId = views[0].id;

      await awaitWithViewEvent(() => deleteView(tableId, deletedViewId));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });
      const restored = await restoreTrash(result.data.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });

    it('should restore fields successfully', async () => {
      const fields = await getFields(tableId);
      const deletedFieldIds = fields.filter((f) => !f.isPrimary).map((f) => f.id);

      await awaitWithFieldEvent(async () => deleteFields(tableId, deletedFieldIds));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });
      const restored = await restoreTrash(result.data.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });

    it('should restore formula fields successfully', async () => {
      const formulaField = await createField(tableId, {
        name: 'Formula',
        type: FieldType.Formula,
        options: {
          expression: '1 + 1',
        },
      });

      await awaitWithFieldEvent(async () => deleteFields(tableId, [formulaField.id]));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });
      const restored = await restoreTrash(result.data.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });

    it('should restore fields successfully', async () => {
      const recordsData = await getRecords(tableId);
      const deletedRecordIds = recordsData.records.map((r) => r.id);

      await awaitWithRecordEvent(() => deleteRecords(tableId, deletedRecordIds));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });
      const restored = await restoreTrash(result.data.trashItems[0].id);

      expect(restored.status).toEqual(201);
    });
  });

  describe('Reset table trash items', () => {
    let tableId: string;

    beforeEach(async () => {
      tableId = (await createTable(baseId, tableVo)).id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableId);
    });

    it('should reset table trash items successfully', async () => {
      const views = await getViews(tableId);
      const fields = await getFields(tableId);
      const recordsData = await getRecords(tableId);

      const deletedViewId = views[0].id;
      const deletedFieldIds = fields.filter((f) => !f.isPrimary).map((f) => f.id);
      const deletedRecordIds = recordsData.records.map((r) => r.id);

      await awaitWithViewEvent(() => deleteView(tableId, deletedViewId));
      await awaitWithFieldEvent(async () => deleteFields(tableId, deletedFieldIds));
      await awaitWithRecordEvent(() => deleteRecords(tableId, deletedRecordIds));

      const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });

      expect(result.data.trashItems.length).toEqual(3);

      await resetTrashItems({ resourceType: ResourceType.Table, resourceId: tableId });

      const resetedResult = await getTrashItems({
        resourceId: tableId,
        resourceType: ResourceType.Table,
      });

      expect(resetedResult.data.trashItems.length).toEqual(0);
    });
  });
});
