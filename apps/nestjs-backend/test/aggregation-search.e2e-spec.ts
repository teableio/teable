import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getSearchCount, getSearchIndex, createField, updateViewColumnMeta } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import { getError } from './utils/get-error';

import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('OpenAPI AggregationController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  let subTable: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  afterAll(async () => {
    await app.close();
  });

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    table = await createTable(baseId, {
      name: 'record_query_x_20',
      fields: x_20.fields,
      records: x_20.records,
    });

    const x20Link = x_20_link(table);
    subTable = await createTable(baseId, {
      name: 'sort_x_20',
      fields: x20Link.fields,
      records: x20Link.records,
    });

    const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
    for (const field of x20LinkFromLookups.fields) {
      await createField(subTable.id, field);
    }

    await createField(table.id, {
      name: 'Formula_Boolean',
      options: {
        expression: `{${table.fields[0].id}} > 1`,
      },
      type: FieldType.Formula,
    });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await permanentDeleteTable(baseId, subTable.id);
  });

  describe('OpenAPI AggregationController (e2e) get count with search query', () => {
    it('should get searchCount', async () => {
      const result = await getSearchCount(table.id, {
        // eslint-disable-next-line sonarjs/no-duplicate-string
        search: ['Text Field', '', false],
      });
      expect(result?.data?.count).toBe(22);
    });

    it('should filter the hidden filed', async () => {
      const result = await getSearchCount(table.id, {
        search: ['1', '', false],
      });
      await updateViewColumnMeta(table.id, table.views[0].id, [
        {
          fieldId: table.fields[1].id,
          columnMeta: { hidden: true },
        },
      ]);
      const result2 = await getSearchCount(table.id, {
        search: ['1', '', false],
        viewId: table.views[0].id,
      });
      expect(result?.data?.count).toBe(86);
      expect(result2?.data?.count).toBe(74);
    });

    it('should return 0 when there is no result', async () => {
      const result = await getSearchCount(table.id, {
        search: ['Go to Gentle night', '', false],
      });
      expect(result?.data?.count).toBe(0);
    });
  });

  describe('OpenAPI AggregationController (e2e) get record index with query', () => {
    it('should get search index', async () => {
      const result = await getSearchIndex(table.id, {
        take: 10,
        search: ['Text Field', '', false],
      });
      const targetFieldId = table.fields?.[0]?.id;
      expect(result?.data?.length).toBe(10);
      expect(result?.data).toEqual([
        { index: 2, fieldId: targetFieldId },
        { index: 3, fieldId: targetFieldId },
        { index: 4, fieldId: targetFieldId },
        { index: 5, fieldId: targetFieldId },
        { index: 6, fieldId: targetFieldId },
        { index: 7, fieldId: targetFieldId },
        { index: 8, fieldId: targetFieldId },
        { index: 9, fieldId: targetFieldId },
        { index: 10, fieldId: targetFieldId },
        { index: 11, fieldId: targetFieldId },
      ]);
    });

    it('should get search index with offset', async () => {
      const result = await getSearchIndex(table.id, {
        take: 10,
        skip: 1,
        search: ['Text Field', '', false],
      });
      const targetFieldId = table.fields?.[0]?.id;
      expect(result?.data?.length).toBe(10);
      expect(result?.data).toEqual([
        { index: 3, fieldId: targetFieldId },
        { index: 4, fieldId: targetFieldId },
        { index: 5, fieldId: targetFieldId },
        { index: 6, fieldId: targetFieldId },
        { index: 7, fieldId: targetFieldId },
        { index: 8, fieldId: targetFieldId },
        { index: 9, fieldId: targetFieldId },
        { index: 10, fieldId: targetFieldId },
        { index: 11, fieldId: targetFieldId },
        { index: 12, fieldId: targetFieldId },
      ]);
    });

    it('should throw a error when take over 1000', async () => {
      const error = await getError(() =>
        getSearchIndex(table.id, {
          take: 1001,
          search: ['Text Field', '', false],
        })
      );
      expect(error?.status).toBe(500);
      expect(error?.message).toBe('The maximum search index result is 1000');
    });

    it('should return null when there is no found', async () => {
      const result2 = await getSearchIndex(table.id, {
        take: 1,
        search: ['Go to Gentle night', '', false],
      });
      expect(result2?.data).toBe('');
    });
  });
});
