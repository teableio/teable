import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable/openapi';
import { getSearchCount, getSearchIndex, createField, updateViewColumnMeta } from '@teable/openapi';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';

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
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await permanentDeleteTable(baseId, subTable.id);
  });

  describe('OpenAPI AggregationController (e2e) get count with search query', () => {
    it('should get searchCount', async () => {
      const result = await getSearchCount(table.id, {
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
      const result2 = await getSearchIndex(table.id, {
        index: 1,
        search: ['Text Field', '', false],
      });
      expect(result2?.data?.index).toBe(2);
      expect(result2?.data?.fieldId).toBe(table.fields[0].id);
    });

    it('should return null when there is no found', async () => {
      const result2 = await getSearchIndex(table.id, {
        index: 1,
        search: ['Go to Gentle night', '', false],
      });
      expect(result2?.data).toBe('');
    });
  });
});
