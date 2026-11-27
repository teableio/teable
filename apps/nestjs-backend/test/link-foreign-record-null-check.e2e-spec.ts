/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */

import type { INestApplication } from '@nestjs/common';
import type { IFieldRo } from '@teable/core';
import { FieldKeyType, FieldType, getRandomString, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { axios } from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getRecord,
  initApp,
  updateRecord,
} from './utils/init-app';

/**
 * Tests for null handling in foreignRecordMap during link field updates.
 *
 * When the junction table and JSONB cell values are out of sync (desync),
 * the foreignRecordMap may not contain all record IDs that appear in the
 * toDelete/toAdd lists. The code must handle missing entries gracefully
 * rather than crashing with TypeError.
 *
 * This covers all four update methods:
 * - updateForeignCellForManyMany
 * - updateForeignCellForManyOne
 * - updateForeignCellForOneMany
 * - updateForeignCellForOneOne
 */
describe('Link foreign record null check (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let eventEmitterService: EventEmitterService;
  let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
    const windowId = 'win' + getRandomString(8);
    axios.interceptors.request.use((config) => {
      config.headers['X-Window-Id'] = windowId;
      return config;
    });
    awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_PUSH);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('ManyMany: removing links should not crash', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;

    afterEach(async () => {
      tableA && (await permanentDeleteTable(baseId, tableA.id));
      tableB && (await permanentDeleteTable(baseId, tableB.id));
    });

    it('should handle removing a subset of links', async () => {
      tableA = await createTable(baseId, {
        name: 'A-mm-remove-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'A1' } }],
      });

      tableB = await createTable(baseId, {
        name: 'B-mm-remove-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'B1' } },
          { fields: { Name: 'B2' } },
          { fields: { Name: 'B3' } },
        ],
      });

      const linkField = await awaitWithEvent(() =>
        createField(tableA.id, {
          name: 'Link',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyMany, foreignTableId: tableB.id },
        })
      );

      // Link A1 -> [B1, B2, B3]
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [linkField.id]: [
                { id: tableB.records[0].id },
                { id: tableB.records[1].id },
                { id: tableB.records[2].id },
              ],
            },
          },
        })
      );

      // Replace links: A1 -> [B1] (removes B2 and B3 via toDelete path)
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [linkField.id]: [{ id: tableB.records[0].id }],
            },
          },
        })
      );

      const record = await getRecord(tableA.id, tableA.records[0].id, FieldKeyType.Id);
      const links = record.fields[linkField.id] as any[];
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(tableB.records[0].id);
    });

    it('should handle clearing all links', async () => {
      tableA = await createTable(baseId, {
        name: 'A-mm-clear-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'A1' } }],
      });

      tableB = await createTable(baseId, {
        name: 'B-mm-clear-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'B1' } },
          { fields: { Name: 'B2' } },
        ],
      });

      const linkField = await awaitWithEvent(() =>
        createField(tableA.id, {
          name: 'Link',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyMany, foreignTableId: tableB.id },
        })
      );

      // Link A1 -> [B1, B2]
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: [{ id: tableB.records[0].id }, { id: tableB.records[1].id }] } },
        })
      );

      // Clear all links: A1 -> null
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: null } },
        })
      );

      const record = await getRecord(tableA.id, tableA.records[0].id, FieldKeyType.Id);
      expect(record.fields[linkField.id]).toBeUndefined();
    });

    it('should handle replacing all links with different set', async () => {
      tableA = await createTable(baseId, {
        name: 'A-mm-replace-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'A1' } }],
      });

      tableB = await createTable(baseId, {
        name: 'B-mm-replace-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'B1' } },
          { fields: { Name: 'B2' } },
          { fields: { Name: 'B3' } },
        ],
      });

      const linkField = await awaitWithEvent(() =>
        createField(tableA.id, {
          name: 'Link',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyMany, foreignTableId: tableB.id },
        })
      );

      // Link A1 -> [B1, B2]
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: [{ id: tableB.records[0].id }, { id: tableB.records[1].id }] } },
        })
      );

      // Replace: A1 -> [B3] (deletes B1, B2; adds B3)
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: [{ id: tableB.records[2].id }] } },
        })
      );

      const record = await getRecord(tableA.id, tableA.records[0].id, FieldKeyType.Id);
      const links = record.fields[linkField.id] as any[];
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(tableB.records[2].id);
    });
  });

  describe('OneMany: removing links should not crash', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;

    afterEach(async () => {
      tableA && (await permanentDeleteTable(baseId, tableA.id));
      tableB && (await permanentDeleteTable(baseId, tableB.id));
    });

    it('should handle removing and replacing links', async () => {
      tableA = await createTable(baseId, {
        name: 'A-om-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'A1' } }],
      });

      tableB = await createTable(baseId, {
        name: 'B-om-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'B1' } },
          { fields: { Name: 'B2' } },
          { fields: { Name: 'B3' } },
        ],
      });

      const linkField = await awaitWithEvent(() =>
        createField(tableA.id, {
          name: 'Link',
          type: FieldType.Link,
          options: { relationship: Relationship.OneMany, foreignTableId: tableB.id },
        })
      );

      // Link A1 -> [B1, B2]
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: [{ id: tableB.records[0].id }, { id: tableB.records[1].id }] } },
        })
      );

      // Replace: A1 -> [B3]
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: [{ id: tableB.records[2].id }] } },
        })
      );

      const record = await getRecord(tableA.id, tableA.records[0].id, FieldKeyType.Id);
      const links = record.fields[linkField.id] as any[];
      expect(links).toHaveLength(1);
      expect(links[0].id).toBe(tableB.records[2].id);
    });
  });

  describe('ManyOne: updating link should not crash', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;

    afterEach(async () => {
      tableA && (await permanentDeleteTable(baseId, tableA.id));
      tableB && (await permanentDeleteTable(baseId, tableB.id));
    });

    it('should handle changing a ManyOne link to a different record', async () => {
      tableA = await createTable(baseId, {
        name: 'A-mo-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'A1' } }],
      });

      tableB = await createTable(baseId, {
        name: 'B-mo-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'B1' } },
          { fields: { Name: 'B2' } },
        ],
      });

      const linkField = await awaitWithEvent(() =>
        createField(tableA.id, {
          name: 'Link',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyOne, foreignTableId: tableB.id },
        })
      );

      // Link A1 -> B1
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: { id: tableB.records[0].id } } },
        })
      );

      // Change: A1 -> B2 (oldKey=B1 goes through deletion path)
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: { id: tableB.records[1].id } } },
        })
      );

      const record = await getRecord(tableA.id, tableA.records[0].id, FieldKeyType.Id);
      const link = record.fields[linkField.id] as any;
      expect(link.id).toBe(tableB.records[1].id);
    });
  });

  describe('OneOne: updating link should not crash', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;

    afterEach(async () => {
      tableA && (await permanentDeleteTable(baseId, tableA.id));
      tableB && (await permanentDeleteTable(baseId, tableB.id));
    });

    it('should handle changing a OneOne link to a different record', async () => {
      tableA = await createTable(baseId, {
        name: 'A-oo-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'A1' } }],
      });

      tableB = await createTable(baseId, {
        name: 'B-oo-' + getRandomString(4),
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'B1' } },
          { fields: { Name: 'B2' } },
        ],
      });

      const linkField = await awaitWithEvent(() =>
        createField(tableA.id, {
          name: 'Link',
          type: FieldType.Link,
          options: { relationship: Relationship.OneOne, foreignTableId: tableB.id },
        })
      );

      // Link A1 -> B1
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: { id: tableB.records[0].id } } },
        })
      );

      // Change: A1 -> B2 (oldKey=B1 goes through deletion path)
      await awaitWithEvent(() =>
        updateRecord(tableA.id, tableA.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: { fields: { [linkField.id]: { id: tableB.records[1].id } } },
        })
      );

      const record = await getRecord(tableA.id, tableA.records[0].id, FieldKeyType.Id);
      const link = record.fields[linkField.id] as any;
      expect(link.id).toBe(tableB.records[1].id);
    });
  });
});
