/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, ViewType } from '@teable/core';
import type { ITableTrashItemVo } from '@teable/openapi';
import {
  RangeType,
  SettingKey,
  createRecords,
  deleteFields,
  deleteRecords,
  deleteSelection,
  deleteView,
  getTrashItems,
  resetTrashItems,
  ResourceType,
  restoreTrash,
  updateSetting,
} from '@teable/openapi';
import { vi } from 'vitest';
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForTableTrashItems = async (tableId: string, expectedCount = 1, maxRetries = 100) => {
  for (let i = 0; i < maxRetries; i++) {
    const result = await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });
    if (result.data.trashItems.length >= expectedCount) {
      return result;
    }
    await sleep(100);
  }

  return await getTrashItems({ resourceId: tableId, resourceType: ResourceType.Table });
};

describe('Trash (e2e)', () => {
  let app: INestApplication;
  let eventEmitterService: EventEmitterService;

  const baseId = globalThis.testConfig.baseId;

  let awaitWithViewEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithFieldEvent: <T>(fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    const appCtx = await initApp();

    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);

    awaitWithViewEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_VIEW_DELETE);
    awaitWithFieldEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_FIELDS_DELETE);
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

      const result = await waitForTableTrashItems(tableId, 1);

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

      await deleteRecords(tableId, deletedRecordIds);

      const result = await waitForTableTrashItems(tableId, 1);

      expect(result.data.trashItems.length).toBe(1);
      expect((result.data.trashItems[0] as ITableTrashItemVo).resourceIds).toEqual(
        deletedRecordIds
      );
    });

    it('should add V2-created records to table trash when deleting by range', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      try {
        const createRes = await createRecords(tableId, {
          records: [
            {
              fields: {
                SingleLineText: `v2-trash-${Date.now()}`,
              },
            },
          ],
        });
        expect(createRes.headers['x-teable-v2']).toBe('true');

        const createdRecordId = createRes.data.records[0].id;
        const recordsData = await getRecords(tableId);
        const rowIndex = recordsData.records.findIndex((record) => record.id === createdRecordId);

        expect(rowIndex).toBeGreaterThanOrEqual(0);

        const deleteRes = await deleteSelection(tableId, {
          type: RangeType.Rows,
          ranges: [[rowIndex, rowIndex]],
        });
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        const trashRes = await getTrashItems({
          resourceId: tableId,
          resourceType: ResourceType.Table,
        });
        expect(trashRes.data.trashItems.length).toBe(1);
        const recordTrash = trashRes.data.trashItems.find(
          (item) => (item as ITableTrashItemVo).resourceType === ResourceType.Record
        ) as ITableTrashItemVo | undefined;

        expect(recordTrash).toBeTruthy();
        expect(recordTrash?.resourceIds).toContain(createdRecordId);
      } finally {
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
      }
    });

    it('should rely on V2 projection for record-id delete without emitting OPERATION_RECORDS_DELETE', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      const emitSpy = vi.spyOn(eventEmitterService, 'emitAsync');
      let hasOperationDeleteEvent = false;

      try {
        const createRes = await createRecords(tableId, {
          records: [
            {
              fields: {
                SingleLineText: `v2-trash-delete-${Date.now()}`,
              },
            },
            {
              fields: {
                SingleLineText: `v2-trash-delete-${Date.now()}-2`,
              },
            },
          ],
        });
        expect(createRes.headers['x-teable-v2']).toBe('true');

        const createdRecordIds = createRes.data.records.map((record) => record.id);
        const deleteRes = await deleteRecords(tableId, createdRecordIds);
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        hasOperationDeleteEvent = emitSpy.mock.calls.some(
          ([eventName]) => eventName === Events.OPERATION_RECORDS_DELETE
        );

        const trashRes = await getTrashItems({
          resourceId: tableId,
          resourceType: ResourceType.Table,
        });
        expect(trashRes.data.trashItems.length).toBe(1);

        const recordTrash = trashRes.data.trashItems.find(
          (item) => (item as ITableTrashItemVo).resourceType === ResourceType.Record
        ) as ITableTrashItemVo | undefined;
        expect(recordTrash).toBeTruthy();
        expect(recordTrash?.resourceIds).toEqual(createdRecordIds);
      } finally {
        emitSpy.mockRestore();
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
      }

      expect(hasOperationDeleteEvent).toBe(false);
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

    it('should restore field when some records were deleted after field deletion', async () => {
      const field = await createField(tableId, {
        name: 'restore field',
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'A' }, { name: 'B' }],
        },
      });

      const options = (field.options as unknown as { choices: { id: string }[] }).choices;

      const created = await createRecords(tableId, {
        records: [
          { fields: { [field.id]: options[0].id } },
          { fields: { [field.id]: options[1].id } },
        ],
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
      });
      const createdRecordIds = created.data.records.map((r) => r.id);

      await awaitWithFieldEvent(async () => deleteFields(tableId, [field.id]));

      await deleteRecords(tableId, [createdRecordIds[0]]);

      const itemsRes = await waitForTableTrashItems(tableId, 2);
      const fieldTrashItem = itemsRes.data.trashItems.find(
        (t) => (t as ITableTrashItemVo).resourceType === ResourceType.Field
      ) as ITableTrashItemVo | undefined;

      expect(fieldTrashItem).toBeTruthy();

      const restored = await restoreTrash(fieldTrashItem!.id);
      expect(restored.status).toEqual(201);

      const afterFields = await getFields(tableId);
      expect(afterFields.find((f) => f.id === field.id)).toBeTruthy();
    });

    it('should restore fields successfully', async () => {
      const recordsData = await getRecords(tableId);
      const deletedRecordIds = recordsData.records.map((r) => r.id);

      await deleteRecords(tableId, deletedRecordIds);

      const result = await waitForTableTrashItems(tableId, 1);
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
      await deleteRecords(tableId, deletedRecordIds);

      const result = await waitForTableTrashItems(tableId, 3);

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
