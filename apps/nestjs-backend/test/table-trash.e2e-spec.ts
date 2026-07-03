/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  Relationship,
  ViewType,
  generateRecordTrashId,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableTrashItemVo } from '@teable/openapi';
import {
  axios,
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
  updateRecords,
  updateSetting,
  urlBuilder,
} from '@teable/openapi';
import { vi } from 'vitest';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { RecordOpenApiService } from '../src/features/record/open-api/record-open-api.service';
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

type IRestoreTrashStreamEvent =
  | {
      id: 'progress';
      phase: 'preparing' | 'restoring';
      batchIndex: number;
      totalCount: number;
      processedCount: number;
      updatedCount: number;
    }
  | {
      id: 'done';
      totalCount: number;
      updatedCount: number;
    }
  | {
      id: 'error';
      phase: 'preparing' | 'restoring' | 'finalizing';
      batchIndex: number;
      totalCount: number;
      processedCount: number;
      updatedCount: number;
      message: string;
      code?: string;
    };

const readRestoreTrashStream = async (response: Response) => {
  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: IRestoreTrashStreamEvent[] = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      events.push(JSON.parse(jsonStr) as IRestoreTrashStreamEvent);
    }
  }

  return events;
};

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
  const isForceV2 = process.env.FORCE_V2_ALL === 'true';
  let app: INestApplication;
  let prisma: PrismaService;
  let eventEmitterService: EventEmitterService;
  let recordOpenApiService: RecordOpenApiService;
  let cookie: string;

  const baseId = globalThis.testConfig.baseId;

  let awaitWithViewEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithFieldEvent: <T>(fn: () => Promise<T>) => Promise<T>;
  const awaitWithFieldDeleteSync = async <T>(fn: () => Promise<T>) =>
    isForceV2 ? fn() : awaitWithFieldEvent(fn);

  beforeAll(async () => {
    const appCtx = await initApp();

    app = appCtx.app;
    cookie = appCtx.cookie;
    prisma = app.get(PrismaService);
    eventEmitterService = app.get(EventEmitterService);
    recordOpenApiService = app.get(RecordOpenApiService);

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

      await awaitWithFieldDeleteSync(async () => deleteFields(tableId, deletedFieldIds));

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

    it('should expose the primary-field display name for V2 record trash and legacy snapshots', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      const primaryValue = `v2-trash-name-${Date.now()}`;

      try {
        const createRes = await createRecords(tableId, {
          records: [
            {
              fields: {
                SingleLineText: primaryValue,
              },
            },
          ],
        });
        expect(createRes.headers['x-teable-v2']).toBe('true');

        const createdRecordId = createRes.data.records[0].id;

        const deleteRes = await deleteRecords(tableId, [createdRecordId]);
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        const trashRes = await waitForTableTrashItems(tableId, 1);
        expect(trashRes.data.resourceMap[createdRecordId]).toMatchObject({
          id: createdRecordId,
          name: primaryValue,
        });

        const recordTrash = await prisma.recordTrash.findFirst({
          where: { tableId, recordId: createdRecordId },
          select: {
            id: true,
            snapshot: true,
          },
        });

        expect(recordTrash).toBeTruthy();

        const snapshotWithName = JSON.parse(recordTrash!.snapshot) as {
          name?: string;
          fields: Record<string, unknown>;
        };
        expect(snapshotWithName.name).toBe(primaryValue);

        delete snapshotWithName.name;

        await prisma.recordTrash.update({
          where: { id: recordTrash!.id },
          data: { snapshot: JSON.stringify(snapshotWithName) },
        });

        const legacyTrashRes = await getTrashItems({
          resourceId: tableId,
          resourceType: ResourceType.Table,
        });
        expect(legacyTrashRes.data.resourceMap[createdRecordId]).toMatchObject({
          id: createdRecordId,
          name: primaryValue,
        });
      } finally {
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
      }
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

      const result = await waitForTableTrashItems(tableId);
      const restored = await restoreTrash(result.data.trashItems[0].id, tableId);

      expect(restored.status).toEqual(201);
    });

    it('should restore fields successfully', async () => {
      const fields = await getFields(tableId);
      const deletedFieldIds = fields.filter((f) => !f.isPrimary).map((f) => f.id);

      await awaitWithFieldDeleteSync(async () => deleteFields(tableId, deletedFieldIds));

      const result = await waitForTableTrashItems(tableId);
      const restored = await restoreTrash(result.data.trashItems[0].id, tableId);

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

      await awaitWithFieldDeleteSync(async () => deleteFields(tableId, [formulaField.id]));

      const result = await waitForTableTrashItems(tableId);
      const restored = await restoreTrash(result.data.trashItems[0].id, tableId);

      expect(restored.status).toEqual(201);
    });

    it('should restore records from the latest matching snapshots when historical record trash exists', async () => {
      const createRes = await createRecords(tableId, {
        records: [
          {
            fields: {
              SingleLineText: `restore-record-trash-${Date.now()}-1`,
            },
          },
          {
            fields: {
              SingleLineText: `restore-record-trash-${Date.now()}-2`,
            },
          },
        ],
        fieldKeyType: FieldKeyType.Name,
      });
      const recordIds = createRes.data.records.map((record) => record.id);

      await deleteRecords(tableId, recordIds);

      const trashItemsRes = await waitForTableTrashItems(tableId, 1);
      const recordTrashItem = trashItemsRes.data.trashItems.find(
        (item) => (item as ITableTrashItemVo).resourceType === ResourceType.Record
      ) as ITableTrashItemVo | undefined;

      expect(recordTrashItem).toBeTruthy();

      const existingRecordTrashRows = await prisma.recordTrash.findMany({
        where: {
          tableId,
          recordId: { in: recordIds },
        },
        select: {
          recordId: true,
          snapshot: true,
          createdBy: true,
          createdTime: true,
        },
      });

      await prisma.recordTrash.createMany({
        data: existingRecordTrashRows.map((row) => ({
          id: generateRecordTrashId(),
          tableId,
          recordId: row.recordId,
          snapshot: row.snapshot,
          createdBy: row.createdBy,
          createdTime: new Date(row.createdTime.getTime() - 60_000),
        })),
      });

      const restored = await restoreTrash(recordTrashItem!.id, tableId);
      expect(restored.status).toEqual(201);

      const recordsAfterRestore = await getRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
      });
      expect(
        recordIds.every((recordId) =>
          recordsAfterRestore.records.some((record) => record.id === recordId)
        )
      ).toBe(true);
    });

    it('should restore V2 record trash through the V2 restore command in canary bases', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      const legacyRestoreSpy = vi.spyOn(recordOpenApiService, 'multipleCreateRecords');
      try {
        const title = `restore-v2-record-trash-${Date.now()}`;
        const createRes = await createRecords(tableId, {
          records: [
            {
              fields: {
                SingleLineText: title,
              },
            },
          ],
          fieldKeyType: FieldKeyType.Name,
        });
        expect(createRes.headers['x-teable-v2']).toBe('true');

        const recordId = createRes.data.records[0].id;
        const deleteRes = await deleteRecords(tableId, [recordId]);
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        const trashItemsRes = await waitForTableTrashItems(tableId, 1);
        const recordTrashItem = trashItemsRes.data.trashItems.find(
          (item) => (item as ITableTrashItemVo).resourceType === ResourceType.Record
        ) as ITableTrashItemVo | undefined;
        expect(recordTrashItem).toBeTruthy();

        const restored = await restoreTrash(recordTrashItem!.id, tableId);
        expect(restored.status).toEqual(201);
        expect(restored.headers['x-teable-v2']).toBe('true');
        expect(restored.headers['x-teable-v2-feature']).toBe('createRecord');
        expect(legacyRestoreSpy).not.toHaveBeenCalled();

        const recordsAfterRestore = await getRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
        });
        expect(recordsAfterRestore.records.some((record) => record.id === recordId)).toBe(true);

        const recordTrashCount = await prisma.recordTrash.count({
          where: { tableId, recordId },
        });
        const tableTrashCount = await prisma.tableTrash.count({
          where: { id: recordTrashItem!.id },
        });

        expect(recordTrashCount).toBe(0);
        expect(tableTrashCount).toBe(0);
      } finally {
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
        legacyRestoreSpy.mockRestore();
      }
    });

    it('should restore V2 field trash values from a sparse snapshot', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      try {
        const field = await createField(tableId, {
          name: `restore-v2-sparse-${Date.now()}`,
          type: FieldType.SingleLineText,
        });
        const created = await createRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: Array.from({ length: 501 }, (_, index) => ({
            fields: {
              [field.id]: `restore-value-${index}`,
            },
          })),
        });
        expect(created.headers['x-teable-v2']).toBe('true');
        const recordIds = created.data.records.map((record) => record.id);

        const deleteRes = await deleteFields(tableId, [field.id]);
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        const itemsRes = await waitForTableTrashItems(tableId, 1);
        const fieldTrashItem = itemsRes.data.trashItems.find(
          (t) => (t as ITableTrashItemVo).resourceType === ResourceType.Field
        ) as ITableTrashItemVo | undefined;

        expect(fieldTrashItem).toBeTruthy();

        const restored = await restoreTrash(fieldTrashItem!.id, tableId);
        expect(restored.status).toEqual(201);
        expect(restored.headers['x-teable-v2']).toBe('true');
        expect(restored.headers['x-teable-v2-feature']).toBe('createField');

        const recordsAfterRestore = await getRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
        });
        const restoredRecord = recordsAfterRestore.records.find(
          (record) => record.id === recordIds[0]
        );
        expect(restoredRecord?.fields[field.id]).toBe('restore-value-0');
      } finally {
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
      }
    });

    it('should stream V2 field trash restore progress while restoring record values', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      const legacyRecordUpdateSpy = vi.spyOn(recordOpenApiService, 'updateRecords');
      try {
        const field = await createField(tableId, {
          name: `restore-v2-stream-${Date.now()}`,
          type: FieldType.SingleLineText,
        });
        const recordsBeforeUpdate = await getRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
        });
        const recordIds = recordsBeforeUpdate.records.slice(0, 3).map((record) => record.id);
        await updateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: recordIds.map((recordId, index) => ({
            id: recordId,
            fields: {
              [field.id]: `stream-restore-value-${index}`,
            },
          })),
        });

        const deleteRes = await deleteFields(tableId, [field.id]);
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        const itemsRes = await waitForTableTrashItems(tableId, 1);
        const fieldTrashItem = itemsRes.data.trashItems.find(
          (item) => (item as ITableTrashItemVo).resourceType === ResourceType.Field
        ) as ITableTrashItemVo | undefined;
        expect(fieldTrashItem).toBeTruthy();

        const response = await fetch(
          axios.getUri({
            baseURL: axios.defaults.baseURL,
            url: urlBuilder('/trash/restore-field/{trashId}/stream', {
              trashId: fieldTrashItem!.id,
            }),
            params: { tableId },
          }),
          {
            method: 'POST',
            headers: {
              Accept: 'text/event-stream',
              Cookie: cookie,
            },
          }
        );

        const events = await readRestoreTrashStream(response);
        const progressEvents = events.filter((event) => event.id === 'progress');
        const doneEvent = events.find((event) => event.id === 'done');

        expect(progressEvents.some((event) => event.updatedCount > 0)).toBe(true);
        expect(doneEvent).toMatchObject({
          id: 'done',
          updatedCount: 3,
        });
        expect(doneEvent).not.toHaveProperty('resourceType');
        expect(response.headers.get('x-teable-v2')).toBe('true');
        expect(response.headers.get('x-teable-v2-feature')).toBe('createField');
        expect(legacyRecordUpdateSpy).not.toHaveBeenCalled();

        const recordsAfterRestore = await getRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
        });
        for (const [index, recordId] of recordIds.entries()) {
          const restoredRecord = recordsAfterRestore.records.find(
            (record) => record.id === recordId
          );
          expect(restoredRecord?.fields[field.id]).toBe(`stream-restore-value-${index}`);
        }
      } finally {
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
        legacyRecordUpdateSpy.mockRestore();
      }
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

      await awaitWithFieldDeleteSync(async () => deleteFields(tableId, [field.id]));

      await deleteRecords(tableId, [createdRecordIds[0]]);

      const itemsRes = await waitForTableTrashItems(tableId, 2);
      const fieldTrashItem = itemsRes.data.trashItems.find(
        (t) => (t as ITableTrashItemVo).resourceType === ResourceType.Field
      ) as ITableTrashItemVo | undefined;

      expect(fieldTrashItem).toBeTruthy();

      const restored = await restoreTrash(fieldTrashItem!.id, tableId);
      expect(restored.status).toEqual(201);

      const afterFields = await getFields(tableId);
      expect(afterFields.find((f) => f.id === field.id)).toBeTruthy();
    });

    it('should restore a two-way link field together with its deleted symmetric field', async () => {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [globalThis.testConfig.spaceId],
        },
      });

      const foreignTable = await createTable(baseId, {
        name: `restore-link-target-${Date.now()}`,
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'target' } }],
      });

      try {
        const linkField = await createField(tableId, {
          name: 'restore link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
          },
        });
        const symmetricFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId;
        expect(symmetricFieldId).toBeTruthy();

        const sourceRecord = (await getRecords(tableId, { fieldKeyType: FieldKeyType.Id }))
          .records[0];
        const targetRecord = (await getRecords(foreignTable.id, { fieldKeyType: FieldKeyType.Id }))
          .records[0];

        await updateRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              id: sourceRecord.id,
              fields: {
                [linkField.id]: [{ id: targetRecord.id }],
              },
            },
          ],
        });

        const deleteRes = await deleteFields(tableId, [linkField.id]);
        expect(deleteRes.headers['x-teable-v2']).toBe('true');

        const deletedMain = await prisma.field.findUnique({ where: { id: linkField.id } });
        const deletedSymmetric = await prisma.field.findUnique({
          where: { id: symmetricFieldId! },
        });
        expect(deletedMain?.deletedTime).toBeTruthy();
        expect(deletedSymmetric?.deletedTime).toBeTruthy();

        const itemsRes = await waitForTableTrashItems(tableId, 1);
        const fieldTrashItem = itemsRes.data.trashItems.find(
          (t) => (t as ITableTrashItemVo).resourceType === ResourceType.Field
        ) as ITableTrashItemVo | undefined;

        expect(fieldTrashItem).toBeTruthy();

        const restored = await restoreTrash(fieldTrashItem!.id, tableId);
        expect(restored.status).toEqual(201);
        expect(restored.headers['x-teable-v2']).toBe('true');
        expect(restored.headers['x-teable-v2-feature']).toBe('createField');

        const afterSourceFields = await getFields(tableId);
        const afterTargetFields = await getFields(foreignTable.id);
        expect(afterSourceFields.find((f) => f.id === linkField.id)).toBeTruthy();
        expect(afterTargetFields.find((f) => f.id === symmetricFieldId)).toBeTruthy();

        const sourceAfterRestore = (
          await getRecords(tableId, { fieldKeyType: FieldKeyType.Id })
        ).records.find((record) => record.id === sourceRecord.id);
        expect(sourceAfterRestore?.fields[linkField.id]).toEqual([
          expect.objectContaining({ id: targetRecord.id }),
        ]);
      } finally {
        await updateSetting({
          [SettingKey.CANARY_CONFIG]: {
            enabled: false,
            spaceIds: [],
          },
        });
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    });

    it('should restore fields successfully', async () => {
      const recordsData = await getRecords(tableId);
      const deletedRecordIds = recordsData.records.map((r) => r.id);

      await deleteRecords(tableId, deletedRecordIds);

      const result = await waitForTableTrashItems(tableId, 1);
      const restored = await restoreTrash(result.data.trashItems[0].id, tableId);

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
      await awaitWithFieldDeleteSync(async () => deleteFields(tableId, deletedFieldIds));
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
