/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  createBase,
  createBaseFromTemplate,
  createSpace,
  createTable,
  createTemplate,
  createTemplateCategory,
  createTemplateSnapshot,
  deleteBase,
  deleteTemplate,
  deleteTemplateCategory,
  getBaseById,
  getFields,
  getPublishedTemplateList,
  getTableList,
  getTemplateCategoryList,
  getTemplateList,
  pinTopTemplate,
  updateTemplate,
  updateTemplateCategory,
} from '@teable/openapi';
import { omit } from 'lodash';
import { deleteSpace, initApp } from './utils/init-app';

describe('Template Open API Controller (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  const spaceId = globalThis.testConfig.spaceId;
  let baseId: string;
  let templateSpaceId: string;

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    prismaService = app.get(PrismaService);

    await prismaService.space.update({
      where: {
        id: 'spcDefaultTempSpcId',
      },
      data: {
        isTemplate: null,
      },
    });
    const spaceData = await createSpace({
      name: 'test Template Space',
    });
    await prismaService.space.update({
      where: {
        id: spaceData.data.id,
      },
      data: {
        createdBy: 'system',
        isTemplate: true,
      },
    });
    templateSpaceId = spaceData.data.id;
  });

  afterAll(async () => {
    await prismaService.space.update({
      where: {
        id: 'spcDefaultTempSpcId',
      },
      data: {
        isTemplate: true,
      },
    });
    await prismaService.space.update({
      where: {
        id: templateSpaceId,
      },
      data: {
        isTemplate: null,
      },
    });
    await deleteSpace(templateSpaceId);
  });

  beforeEach(async () => {
    const { id } = (
      await createBase({
        name: 'test base',
        spaceId,
      })
    ).data;
    baseId = id;
  });

  afterEach(async () => {
    await prismaService.templateCategory.deleteMany({
      where: {},
    });
    await prismaService.template.deleteMany({
      where: {},
    });
    await deleteBase(baseId);
  });

  it('should create a empty template', async () => {
    const res = await createTemplate({});
    expect(res.status).toBe(201);
    expect(res.data).toBeDefined();
  });

  it('should get template list', async () => {
    const res1 = await getTemplateList();
    expect(res1.status).toBe(200);
    expect(res1.data.length).toBe(0);

    await createTemplate({});
    const res2 = await getTemplateList();
    expect(res2.status).toBe(200);
    expect(res2.data.length).toBe(1);
  });

  it('should get published template list', async () => {
    const res1 = await getPublishedTemplateList();
    expect(res1.status).toBe(200);
    expect(res1.data.length).toBe(0);

    const template = await createTemplate({});
    await updateTemplate(template.data.id, {
      name: 'test Template',
      description: 'test Template description',
      baseId: baseId,
    });

    await createTemplateSnapshot(template.data.id);
    await updateTemplate(template.data.id, {
      isPublished: true,
    });
    const res2 = await getPublishedTemplateList();
    expect(res2.status).toBe(200);
    expect(res2.data.length).toBe(1);
  });

  it('should pin-top template', async () => {
    const tmp1 = await createTemplate({});
    const tmp2 = await createTemplate({});
    const tmp3 = await createTemplate({});

    const tmpList = await getTemplateList();
    expect(tmpList.status).toBe(200);
    expect(tmpList.data.length).toBe(3);
    expect(tmpList.data.map(({ id }) => id)).toEqual([tmp1.data.id, tmp2.data.id, tmp3.data.id]);

    await pinTopTemplate(tmp3.data.id);

    const tmpList2 = await getTemplateList();
    expect(tmpList2.status).toBe(200);
    expect(tmpList2.data.length).toBe(3);
    expect(tmpList2.data.map(({ id }) => id)).toEqual([tmp3.data.id, tmp1.data.id, tmp2.data.id]);
  });

  it('should support update template markdown description and get ', async () => {
    const template = await createTemplate({});
    await updateTemplate(template.data.id, {
      markdownDescription: '# test markdown description',
    });
    const tmpList = await getTemplateList();
    expect(tmpList.status).toBe(200);
    expect(tmpList.data.length).toBe(1);
    expect(tmpList.data[0].markdownDescription).toBe('# test markdown description');
  });

  it('should delete template', async () => {
    const template = await createTemplate({});
    const res1 = await getTemplateList();
    expect(res1.status).toBe(200);
    expect(res1.data.length).toBe(1);
    await deleteTemplate(template.data.id);
    const res2 = await getTemplateList();
    expect(res2.status).toBe(200);
    expect(res2.data.length).toBe(0);
  });

  describe('Template Category', () => {
    it('should create template category', async () => {
      const res = await createTemplateCategory({
        name: 'crm',
      });
      expect(res.status).toBe(201);
      expect(res.data?.name).toBe('crm');
      expect(res.data?.order).toBe(1);

      const res2 = await getTemplateCategoryList();
      expect(res2.status).toBe(200);
      expect(res2.data.length).toBe(1);
    });

    it('should update template category', async () => {
      const res = await createTemplateCategory({
        name: 'crm',
      });
      expect(res.status).toBe(201);
      expect(res.data?.name).toBe('crm');

      await updateTemplateCategory(res.data.id, {
        name: 'crm2',
      });

      const res2 = await getTemplateCategoryList();
      expect(res2.status).toBe(200);
      expect(res2.data?.[0].name).toBe('crm2');
    });

    it('should delete template category', async () => {
      const res = await createTemplateCategory({
        name: 'crm',
      });
      expect(res.status).toBe(201);
      expect(res.data?.name).toBe('crm');

      await deleteTemplateCategory(res.data.id);

      const res2 = await getTemplateCategoryList();
      expect(res2.status).toBe(200);
      expect(res2.data.length).toBe(0);
    });
  });

  describe('Create Base From Template', () => {
    let templateId: string;
    let templateBaseId: string;
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create a template in a base
      const templateBase = await createBase({
        name: 'Template Base',
        icon: '🚀',
        spaceId,
      });
      templateBaseId = templateBase.data.id;
      table1 = (
        await createTable(templateBaseId, {
          name: 'table1',
        })
      ).data;

      table2 = (
        await createTable(templateBaseId, {
          name: 'table2',
        })
      ).data;

      // use this base to be a template
      const template = await createTemplate({});
      templateId = template.data.id;

      await updateTemplate(template.data.id, {
        name: 'test Template',
        description: 'test Template description',
        baseId: templateBaseId,
      });

      await createTemplateSnapshot(template.data.id);

      await updateTemplate(template.data.id, {
        isPublished: true,
      });
    });

    afterEach(async () => {
      await deleteBase(templateBaseId);
    });

    it('should create base from template', async () => {
      const createBaseRes = (
        await createBaseFromTemplate({
          spaceId,
          templateId,
          withRecords: true,
        })
      ).data;
      const createdBaseId = createBaseRes.id;
      const tables = (await getTableList(createdBaseId)).data;
      // table
      expect(tables.length).toBe(2);
      expect(tables[0].name).toBe('table1');
      expect(tables[1].name).toBe('table2');
      const table1Fields = (await getFields(tables[0].id)).data?.map((f) => omit(f, ['id']));
      const table2Fields = (await getFields(tables[1].id)).data?.map((f) => omit(f, ['id']));

      // fields
      const originalTable1Fields = table1.fields.map((f) => omit(f, ['id']));
      const originalTable2Fields = table2.fields.map((f) => omit(f, ['id']));
      expect(table1Fields).toEqual(originalTable1Fields);
      expect(table2Fields).toEqual(originalTable2Fields);
    });

    it('should apply template to a base', async () => {
      const applyBase = await createBase({
        name: 'Apply Base',
        spaceId,
      });

      // remain original base table
      await createTable(applyBase.data.id, {
        name: 'table3',
      });

      const createBaseRes = (
        await createBaseFromTemplate({
          spaceId,
          templateId,
          withRecords: true,
          baseId: applyBase.data.id,
        })
      ).data;

      const createdBaseId = createBaseRes.id;
      const tables = (await getTableList(createdBaseId)).data;
      // table
      expect(tables.length).toBe(3);
      expect(tables[1].name).toBe('table1');
      expect(tables[2].name).toBe('table2');
      const table1Fields = (await getFields(tables[1].id)).data?.map((f) => omit(f, ['id']));
      const table2Fields = (await getFields(tables[2].id)).data?.map((f) => omit(f, ['id']));

      // fields
      const originalTable1Fields = table1.fields.map((f) => omit(f, ['id']));
      const originalTable2Fields = table2.fields.map((f) => omit(f, ['id']));
      expect(table1Fields).toEqual(originalTable1Fields);
      expect(table2Fields).toEqual(originalTable2Fields);

      // base icon and name
      const applyBaseInfo = (await getBaseById(applyBase.data.id)).data;
      expect(applyBaseInfo.icon).toBe('🚀');
      expect(applyBaseInfo.name).toBe('test Template');
    });
  });
});
