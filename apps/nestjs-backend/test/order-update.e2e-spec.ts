import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable/core';
import type { ITableFullVo, ICreateBaseVo, ICreateSpaceVo } from '@teable/openapi';
import {
  createBase,
  createSpace,
  createTable,
  deleteBase,
  deleteSpace,
  getBaseList,
  getTableList,
  updateBaseOrder,
  updateRecordOrders,
  updateTableOrder,
  updateViewOrder,
} from '@teable/openapi';
import {
  initApp,
  createView,
  permanentDeleteTable,
  getViews,
  getRecords,
  createRecords,
} from './utils/init-app';

describe('order update', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('record', () => {
    const baseId = globalThis.testConfig.baseId;
    let table: ITableFullVo;
    beforeEach(async () => {
      table = (await createTable(baseId, { name: 'table1' })).data;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should update record order', async () => {
      const viewId = table.views[0].id;
      const record1 = { id: table.records[0].id };
      const record2 = { id: table.records[1].id };
      const record3 = { id: table.records[2].id };

      await updateRecordOrders(table.id, viewId, {
        anchorId: record2.id,
        position: 'before',
        recordIds: [record3.id],
      });
      const data1 = await getRecords(table.id, { viewId });
      expect(data1.records).toMatchObject([record1, record3, record2]);

      await updateRecordOrders(table.id, viewId, {
        anchorId: record1.id,
        position: 'before',
        recordIds: [record3.id, record2.id],
      });
      const data2 = await getRecords(table.id, { viewId });
      expect(data2.records).toMatchObject([record3, record2, record1]);

      await updateRecordOrders(table.id, viewId, {
        anchorId: record1.id,
        position: 'after',
        recordIds: [record3.id, record2.id],
      });
      const data3 = await getRecords(table.id, { viewId });
      expect(data3.records).toMatchObject([record1, record3, record2]);

      await updateRecordOrders(table.id, viewId, {
        anchorId: record3.id,
        position: 'after',
        recordIds: [record2.id, record3.id],
      });
      const data4 = await getRecords(table.id, { viewId });
      expect(data4.records).toMatchObject([record1, record2, record3]);

      const result = await createRecords(table.id, {
        records: [{ fields: {} }],
        order: {
          viewId,
          anchorId: record1.id,
          position: 'before',
        },
      });
      const data5 = await getRecords(table.id, { viewId });
      expect(data5.records).toMatchObject([
        { id: result.records[0].id },
        record1,
        record2,
        record3,
      ]);
    });

    it('should create record with order', async () => {
      const viewId = table.views[0].id;
      const record1 = { id: table.records[0].id };
      const record2 = { id: table.records[1].id };
      const record3 = { id: table.records[2].id };

      const result = await createRecords(table.id, {
        records: [{ fields: {} }],
        order: {
          viewId,
          anchorId: record1.id,
          position: 'before',
        },
      });
      const data1 = await getRecords(table.id, { viewId });
      expect(data1.records).toMatchObject([
        { id: result.records[0].id },
        record1,
        record2,
        record3,
      ]);

      const result2 = await createRecords(table.id, {
        records: [{ fields: {} }],
        order: {
          viewId,
          anchorId: record3.id,
          position: 'after',
        },
      });
      const data2 = await getRecords(table.id, { viewId });
      expect(data2.records).toMatchObject([
        { id: result.records[0].id },
        record1,
        record2,
        record3,
        { id: result2.records[0].id },
      ]);
    });
  });

  describe('view', () => {
    const baseId = globalThis.testConfig.baseId;
    let table: ITableFullVo;
    beforeEach(async () => {
      table = (await createTable(baseId, { name: 'table1' })).data;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should update view order', async () => {
      const view1 = { id: table.views[0].id };

      const view2 = {
        id: (
          await createView(table.id, {
            name: 'view',
            type: ViewType.Grid,
          })
        ).id,
      };

      const view3 = {
        id: (
          await createView(table.id, {
            name: 'view',
            type: ViewType.Grid,
          })
        ).id,
      };

      await updateViewOrder(table.id, view3.id, { anchorId: view2.id, position: 'before' });
      const views = await getViews(table.id);
      expect(views).toMatchObject([view1, view3, view2]);

      await updateViewOrder(table.id, view3.id, { anchorId: view1.id, position: 'before' });
      const views2 = await getViews(table.id);
      expect(views2).toMatchObject([view3, view1, view2]);

      await updateViewOrder(table.id, view3.id, { anchorId: view1.id, position: 'after' });
      const views3 = await getViews(table.id);
      expect(views3).toMatchObject([view1, view3, view2]);

      await updateViewOrder(table.id, view3.id, { anchorId: view2.id, position: 'after' });
      const views4 = await getViews(table.id);
      expect(views4).toMatchObject([view1, view2, view3]);
    });
  });

  describe('table', () => {
    const spaceId = globalThis.testConfig.spaceId;
    let base: ICreateBaseVo;
    beforeEach(async () => {
      base = (await createBase({ spaceId, name: 'base1' })).data;
    });

    afterEach(async () => {
      await deleteBase(base.id);
    });

    it('should update table order', async () => {
      const table1 = {
        id: (await createTable(base.id)).data.id,
      };

      const table2 = {
        id: (await createTable(base.id)).data.id,
      };

      const table3 = {
        id: (await createTable(base.id)).data.id,
      };

      await updateTableOrder(base.id, table3.id, { anchorId: table2.id, position: 'before' });
      const tables = (await getTableList(base.id)).data;
      expect(tables).toMatchObject([table1, table3, table2]);

      await updateTableOrder(base.id, table3.id, { anchorId: table1.id, position: 'before' });
      const tables2 = (await getTableList(base.id)).data;
      expect(tables2).toMatchObject([table3, table1, table2]);

      await updateTableOrder(base.id, table3.id, { anchorId: table1.id, position: 'after' });
      const tables3 = (await getTableList(base.id)).data;
      expect(tables3).toMatchObject([table1, table3, table2]);

      await updateTableOrder(base.id, table3.id, { anchorId: table2.id, position: 'after' });
      const tables4 = (await getTableList(base.id)).data;
      expect(tables4).toMatchObject([table1, table2, table3]);
    });
  });

  describe('base', () => {
    let space: ICreateSpaceVo;
    beforeEach(async () => {
      space = (await createSpace({})).data;
    });

    afterEach(async () => {
      await deleteSpace(space.id);
    });

    it('should update base order', async () => {
      const base1 = {
        id: (await createBase({ spaceId: space.id })).data.id,
      };

      const base2 = {
        id: (await createBase({ spaceId: space.id })).data.id,
      };

      const base3 = {
        id: (await createBase({ spaceId: space.id })).data.id,
      };

      await updateBaseOrder({ baseId: base3.id, anchorId: base2.id, position: 'before' });
      const bases = (await getBaseList({ spaceId: space.id })).data;
      expect(bases).toMatchObject([base1, base3, base2]);

      await updateBaseOrder({ baseId: base3.id, anchorId: base1.id, position: 'before' });
      const bases2 = (await getBaseList({ spaceId: space.id })).data;
      expect(bases2).toMatchObject([base3, base1, base2]);

      await updateBaseOrder({ baseId: base3.id, anchorId: base1.id, position: 'after' });
      const bases3 = (await getBaseList({ spaceId: space.id })).data;
      expect(bases3).toMatchObject([base1, base3, base2]);

      await updateBaseOrder({ baseId: base3.id, anchorId: base2.id, position: 'after' });
      const bases4 = (await getBaseList({ spaceId: space.id })).data;
      expect(bases4).toMatchObject([base1, base2, base3]);
    });
  });
});
