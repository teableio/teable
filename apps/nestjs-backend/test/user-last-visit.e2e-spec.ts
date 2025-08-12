import type { INestApplication } from '@nestjs/common';
import type { IViewVo } from '@teable/core';
import { ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateBaseVo, ITableFullVo } from '@teable/openapi';
import {
  createBase,
  createTable,
  createView,
  deleteBase,
  deleteView,
  getUserLastVisit,
  getUserLastVisitListBase,
  getUserLastVisitMap,
  LastVisitResourceType,
  permanentDeleteTable,
  updateUserLastVisit,
  userLastVisitListBaseVoSchema,
} from '@teable/openapi';
import { getViews, initApp, permanentDeleteBase } from './utils/init-app';

describe('OpenAPI OAuthController (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo;
  let table2: ITableFullVo;
  let view1: IViewVo;
  let base: ICreateBaseVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    base = await createBase({ spaceId: globalThis.testConfig.spaceId, name: 'base' }).then(
      (res) => res.data
    );
    table1 = await createTable(base.id, { name: 'table1' }).then((res) => res.data);
    table2 = await createTable(base.id, { name: 'table2' }).then((res) => res.data);
    view1 = await createView(table1.id, { type: ViewType.Grid, name: 'view2', order: 1 }).then(
      (res) => res.data
    );
  });

  afterAll(async () => {
    await permanentDeleteTable(base.id, table1.id);
    await permanentDeleteTable(base.id, table2.id);
    await deleteBase(base.id);
    await app.close();
  });

  it('should get default last visit', async () => {
    const res = await getUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res.data).toEqual({
      resourceId: table1.id,
      childResourceId: table1.views[0].id,
      resourceType: LastVisitResourceType.Table,
    });
  });

  it('should get last visit', async () => {
    await updateUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
      resourceId: table2.id,
    });

    const res = await getUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res.data).toEqual({
      resourceId: table2.id,
      childResourceId: table2.views[0].id,
      resourceType: LastVisitResourceType.Table,
    });

    await updateUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
      resourceId: table1.id,
    });

    const res2 = await getUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res2.data).toEqual({
      resourceId: table1.id,
      childResourceId: table1.views[0].id,
      resourceType: LastVisitResourceType.Table,
    });
  });

  it('should get last visit with child resource', async () => {
    await updateUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
      resourceId: table1.id,
      childResourceId: view1.id,
    });

    const res = await getUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res.data).toEqual({
      resourceId: table1.id,
      childResourceId: view1.id,
      resourceType: LastVisitResourceType.Table,
    });

    const res2 = await getUserLastVisit({
      resourceType: LastVisitResourceType.View,
      parentResourceId: table1.id,
    });

    expect(res2.data).toEqual({
      resourceId: view1.id,
      resourceType: LastVisitResourceType.View,
    });
  });

  it('should fallback to default view when delete a view', async () => {
    await updateUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
      resourceId: table1.id,
      childResourceId: view1.id,
    });

    await deleteView(table1.id, view1.id);

    const res = await getUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res.data).toEqual({
      resourceId: table1.id,
      childResourceId: table1.views[0].id,
      resourceType: LastVisitResourceType.Table,
    });

    const res2 = await getUserLastVisit({
      resourceType: LastVisitResourceType.View,
      parentResourceId: table1.id,
    });

    expect(res2.data).toEqual({
      resourceId: table1.views[0].id,
      resourceType: LastVisitResourceType.View,
    });

    const res3 = await getUserLastVisitMap({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res3.data).toEqual({
      [table1.id]: {
        parentResourceId: table1.id,
        resourceId: table1.views[0].id,
        resourceType: LastVisitResourceType.View,
      },
      [table2.id]: {
        parentResourceId: table2.id,
        resourceId: table2.views[0].id,
        resourceType: LastVisitResourceType.View,
      },
    });
  });

  it('should fallback to default view when delete a view without any visit', async () => {
    await createView(table1.id, { type: ViewType.Grid, name: 'view2', order: 1 });

    await deleteView(table1.id, table1.views[0].id);
    const views = await getViews(table1.id);

    const res = await getUserLastVisit({
      resourceType: LastVisitResourceType.Table,
      parentResourceId: base.id,
    });

    expect(res.data).toEqual({
      resourceId: table1.id,
      childResourceId: views[0].id,
      resourceType: LastVisitResourceType.Table,
    });
  });

  it('should get last visit list base', async () => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const base_21: ICreateBaseVo[] = [];

    for (let i = 0; i < 21; i++) {
      const base = await createBase({
        spaceId: globalThis.testConfig.spaceId,
        name: `base_${i}`,
      }).then((res) => res.data);
      base_21.push(base);
    }

    for (const base of base_21) {
      await updateUserLastVisit({
        resourceType: LastVisitResourceType.Base,
        parentResourceId: base.spaceId,
        resourceId: base.id,
      });
    }

    const res = await getUserLastVisitListBase();

    for (const base of base_21) {
      await deleteBase(base.id);
      await permanentDeleteBase(base.id);
    }
    expect(userLastVisitListBaseVoSchema.safeParse(res.data).success).toEqual(true);
    expect(res.data.list.length).toEqual(10);
    expect(res.data.total).toEqual(10);
    expect(res.data.list[0].resource.id).toEqual(base_21[20].id);
    expect(res.data.list[9].resource.id).toEqual(base_21[11].id);

    const res2 = await getUserLastVisitListBase();

    expect(res2.data.list.length).toEqual(0);

    const prisma = app.get(PrismaService);
    const userLastVisit = await prisma.userLastVisit.findMany({
      where: {
        parentResourceId: base_21[0].spaceId,
      },
    });
    expect(userLastVisit.length).toEqual(0);
  });
});
