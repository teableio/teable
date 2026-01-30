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
  getTemplatePermalink,
  pinTopTemplate,
  updateTemplate,
  updateTemplateCategory,
  updateTemplateCategoryOrder,
  updateTemplateOrder,
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
    const tx = prismaService.txClient();
    await tx.space.update({
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
    await tx.space.update({
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
    const tx = prismaService.txClient();
    await tx.templateCategory.deleteMany({
      where: {},
    });
    await tx.template.deleteMany({
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

  describe('Template Order', () => {
    beforeEach(async () => {
      // Ensure database is clean before each test
      const tx = prismaService.txClient();
      await tx.template.deleteMany({
        where: {},
      });
    });

    it('should update template order - move to before anchor', async () => {
      // Create 3 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});

      // Initial order: [tmp1, tmp2, tmp3]
      const initialList = await getTemplateList();
      expect(initialList.data.map(({ id }) => id)).toEqual([
        tmp1.data.id,
        tmp2.data.id,
        tmp3.data.id,
      ]);

      // Move tmp3 before tmp1
      await updateTemplateOrder({
        templateId: tmp3.data.id,
        anchorId: tmp1.data.id,
        position: 'before',
      });

      // Expected order: [tmp3, tmp1, tmp2]
      const updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp3.data.id,
        tmp1.data.id,
        tmp2.data.id,
      ]);
    });

    it('should update template order - move to after anchor', async () => {
      // Create 3 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});

      // Initial order: [tmp1, tmp2, tmp3]
      const initialList = await getTemplateList();
      expect(initialList.data.map(({ id }) => id)).toEqual([
        tmp1.data.id,
        tmp2.data.id,
        tmp3.data.id,
      ]);

      // Move tmp1 after tmp3
      await updateTemplateOrder({
        templateId: tmp1.data.id,
        anchorId: tmp3.data.id,
        position: 'after',
      });

      // Expected order: [tmp2, tmp3, tmp1]
      const updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp2.data.id,
        tmp3.data.id,
        tmp1.data.id,
      ]);
    });

    it('should update template order - move middle item before first', async () => {
      // Create 3 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});

      // Initial order: [tmp1, tmp2, tmp3]
      // Move tmp2 before tmp1
      await updateTemplateOrder({
        templateId: tmp2.data.id,
        anchorId: tmp1.data.id,
        position: 'before',
      });

      // Expected order: [tmp2, tmp1, tmp3]
      const updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp2.data.id,
        tmp1.data.id,
        tmp3.data.id,
      ]);
    });

    it('should update template order - move middle item after last', async () => {
      // Create 3 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});

      // Initial order: [tmp1, tmp2, tmp3]
      // Move tmp2 after tmp3
      await updateTemplateOrder({
        templateId: tmp2.data.id,
        anchorId: tmp3.data.id,
        position: 'after',
      });

      // Expected order: [tmp1, tmp3, tmp2]
      const updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp1.data.id,
        tmp3.data.id,
        tmp2.data.id,
      ]);
    });

    it('should update template order - complex reordering', async () => {
      // Create 5 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});
      const tmp4 = await createTemplate({});
      const tmp5 = await createTemplate({});

      // Initial order: [tmp1, tmp2, tmp3, tmp4, tmp5]
      const initialList = await getTemplateList();
      expect(initialList.data.map(({ id }) => id)).toEqual([
        tmp1.data.id,
        tmp2.data.id,
        tmp3.data.id,
        tmp4.data.id,
        tmp5.data.id,
      ]);

      // Move tmp5 before tmp2
      await updateTemplateOrder({
        templateId: tmp5.data.id,
        anchorId: tmp2.data.id,
        position: 'before',
      });

      // Expected order: [tmp1, tmp5, tmp2, tmp3, tmp4]
      let updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp1.data.id,
        tmp5.data.id,
        tmp2.data.id,
        tmp3.data.id,
        tmp4.data.id,
      ]);

      // Move tmp1 after tmp4
      await updateTemplateOrder({
        templateId: tmp1.data.id,
        anchorId: tmp4.data.id,
        position: 'after',
      });

      // Expected order: [tmp5, tmp2, tmp3, tmp4, tmp1]
      updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp5.data.id,
        tmp2.data.id,
        tmp3.data.id,
        tmp4.data.id,
        tmp1.data.id,
      ]);

      // Move tmp3 before tmp5
      await updateTemplateOrder({
        templateId: tmp3.data.id,
        anchorId: tmp5.data.id,
        position: 'before',
      });

      // Expected order: [tmp3, tmp5, tmp2, tmp4, tmp1]
      updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp3.data.id,
        tmp5.data.id,
        tmp2.data.id,
        tmp4.data.id,
        tmp1.data.id,
      ]);
    });

    it('should handle adjacent template reordering', async () => {
      // Create 3 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});

      // Move tmp2 after tmp1 (already in this position, but should work)
      await updateTemplateOrder({
        templateId: tmp2.data.id,
        anchorId: tmp1.data.id,
        position: 'after',
      });

      // Order should remain: [tmp1, tmp2, tmp3]
      let updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp1.data.id,
        tmp2.data.id,
        tmp3.data.id,
      ]);

      // Swap tmp1 and tmp2 by moving tmp1 after tmp2
      await updateTemplateOrder({
        templateId: tmp1.data.id,
        anchorId: tmp2.data.id,
        position: 'after',
      });

      // Expected order: [tmp2, tmp1, tmp3]
      updatedList = await getTemplateList();
      expect(updatedList.data.map(({ id }) => id)).toEqual([
        tmp2.data.id,
        tmp1.data.id,
        tmp3.data.id,
      ]);
    });

    it('should maintain order consistency after multiple operations', async () => {
      // Create 4 templates
      const tmp1 = await createTemplate({});
      const tmp2 = await createTemplate({});
      const tmp3 = await createTemplate({});
      const tmp4 = await createTemplate({});

      // Perform multiple reordering operations
      await updateTemplateOrder({
        templateId: tmp4.data.id,
        anchorId: tmp1.data.id,
        position: 'before',
      });
      // Order: [tmp4, tmp1, tmp2, tmp3]

      await updateTemplateOrder({
        templateId: tmp2.data.id,
        anchorId: tmp4.data.id,
        position: 'before',
      });
      // Order: [tmp2, tmp4, tmp1, tmp3]

      await updateTemplateOrder({
        templateId: tmp3.data.id,
        anchorId: tmp2.data.id,
        position: 'after',
      });
      // Order: [tmp2, tmp3, tmp4, tmp1]

      const finalList = await getTemplateList();
      expect(finalList.data.map(({ id }) => id)).toEqual([
        tmp2.data.id,
        tmp3.data.id,
        tmp4.data.id,
        tmp1.data.id,
      ]);
    });
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

  describe('Template List Pagination', () => {
    it('should paginate template list with skip and take', async () => {
      // Create 5 templates
      await Promise.all([
        createTemplate({}),
        createTemplate({}),
        createTemplate({}),
        createTemplate({}),
        createTemplate({}),
      ]);

      // Get all templates for verification
      const allTemplates = await getTemplateList();
      const allTemplateIds = allTemplates.data.map((t) => t.id);
      expect(allTemplateIds.length).toBe(5);

      // Get first 2 templates
      const res1 = await getTemplateList({ skip: 0, take: 2 });
      expect(res1.status).toBe(200);
      expect(res1.data.length).toBe(2);
      const res1Ids = res1.data.map((t) => t.id);

      // Skip 2, get next 2 templates
      const res2 = await getTemplateList({ skip: 2, take: 2 });
      expect(res2.status).toBe(200);
      expect(res2.data.length).toBe(2);
      const res2Ids = res2.data.map((t) => t.id);

      // Skip 4, get last 1 template
      const res3 = await getTemplateList({ skip: 4, take: 2 });
      expect(res3.status).toBe(200);
      expect(res3.data.length).toBe(1);
      const res3Ids = res3.data.map((t) => t.id);

      // Verify all returned IDs are in the total list
      const paginatedIds = [...res1Ids, ...res2Ids, ...res3Ids];
      expect(paginatedIds.every((id) => allTemplateIds.includes(id))).toBe(true);

      // Verify pagination results have no duplicates
      expect(new Set(paginatedIds).size).toBe(5);

      // Verify pagination results cover all templates
      expect(paginatedIds.sort()).toEqual(allTemplateIds.sort());
    });

    it('should handle skip beyond total count', async () => {
      // Create 3 templates
      await Promise.all([createTemplate({}), createTemplate({}), createTemplate({})]);

      // Skip 10 (beyond total count)
      const res = await getTemplateList({ skip: 10, take: 5 });
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(0);
    });

    it('should handle take with 0', async () => {
      // Create 3 templates
      await Promise.all([createTemplate({}), createTemplate({}), createTemplate({})]);

      // Take is 0
      const res = await getTemplateList({ skip: 0, take: 0 });
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(0);
    });

    it('should return all templates when skip and take not provided', async () => {
      // Create 5 templates
      await Promise.all([
        createTemplate({}),
        createTemplate({}),
        createTemplate({}),
        createTemplate({}),
        createTemplate({}),
      ]);

      const res = await getTemplateList();
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(5);
    });
  });

  describe('Published Template List Pagination', () => {
    const publishedBases: string[] = [];

    beforeEach(async () => {
      // Create separate base for each template because base_id has unique constraint
      for (let i = 0; i < 5; i++) {
        const base = await createBase({
          name: `test base ${i}`,
          spaceId,
        });
        publishedBases.push(base.data.id);

        const template = await createTemplate({});
        await updateTemplate(template.data.id, {
          name: `test Template ${i}`,
          description: `test Template description ${i}`,
          baseId: base.data.id,
        });
        await createTemplateSnapshot(template.data.id);
        await updateTemplate(template.data.id, {
          isPublished: true,
        });
      }
    });

    afterEach(async () => {
      // Clean up created bases
      for (const publishedBaseId of publishedBases) {
        await deleteBase(publishedBaseId);
      }
      publishedBases.length = 0;
    });

    it('should paginate published template list with skip and take', async () => {
      // Get first 2 templates
      const res1 = await getPublishedTemplateList({ skip: 0, take: 2 });
      expect(res1.status).toBe(200);
      expect(res1.data.length).toBe(2);

      // Skip 2, get next 2 templates
      const res2 = await getPublishedTemplateList({ skip: 2, take: 2 });
      expect(res2.status).toBe(200);
      expect(res2.data.length).toBe(2);

      // Skip 4, get last 1 template
      const res3 = await getPublishedTemplateList({ skip: 4, take: 2 });
      expect(res3.status).toBe(200);
      expect(res3.data.length).toBe(1);
    });

    it('should handle skip beyond total published count', async () => {
      // Skip 50 (beyond total count)
      const res = await getPublishedTemplateList({ skip: 50, take: 5 });
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(0);
    });

    it('should only return published templates with pagination', async () => {
      // Create an unpublished template (without baseId to avoid unique constraint conflict)
      const unpublishedTemplate = await createTemplate({});
      await updateTemplate(unpublishedTemplate.data.id, {
        name: 'unpublished template',
        description: 'unpublished description',
      });

      // Get all published templates
      const res = await getPublishedTemplateList({ skip: 0, take: 50 });
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(5); // Should only have 5 published templates
      expect(res.data.every((t) => t.id !== unpublishedTemplate.data.id)).toBe(true);
    });

    it('should paginate with search parameter', async () => {
      // Search for templates containing 'Template 2'
      const res = await getPublishedTemplateList({ skip: 0, take: 10, search: 'Template 2' });
      expect(res.status).toBe(200);
      expect(res.data.length).toBe(1);
      expect(res.data[0].name).toBe('test Template 2');
    });
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

    describe('Template Category Order', () => {
      it('should update template category order - move to before anchor', async () => {
        // Create 3 categories
        const cat1 = await createTemplateCategory({ name: 'category1' });
        const cat2 = await createTemplateCategory({ name: 'category2' });
        const cat3 = await createTemplateCategory({ name: 'category3' });

        // Initial order: [cat1, cat2, cat3]
        const initialList = await getTemplateCategoryList();
        expect(initialList.data.map(({ id }) => id)).toEqual([
          cat1.data.id,
          cat2.data.id,
          cat3.data.id,
        ]);

        // Move cat3 before cat1
        await updateTemplateCategoryOrder({
          templateCategoryId: cat3.data.id,
          anchorId: cat1.data.id,
          position: 'before',
        });

        // Expected order: [cat3, cat1, cat2]
        const updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat3.data.id,
          cat1.data.id,
          cat2.data.id,
        ]);
      });

      it('should update template category order - move to after anchor', async () => {
        // Create 3 categories
        const cat1 = await createTemplateCategory({ name: 'category1' });
        const cat2 = await createTemplateCategory({ name: 'category2' });
        const cat3 = await createTemplateCategory({ name: 'category3' });

        // Initial order: [cat1, cat2, cat3]
        const initialList = await getTemplateCategoryList();
        expect(initialList.data.map(({ id }) => id)).toEqual([
          cat1.data.id,
          cat2.data.id,
          cat3.data.id,
        ]);

        // Move cat1 after cat3
        await updateTemplateCategoryOrder({
          templateCategoryId: cat1.data.id,
          anchorId: cat3.data.id,
          position: 'after',
        });

        // Expected order: [cat2, cat3, cat1]
        const updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat2.data.id,
          cat3.data.id,
          cat1.data.id,
        ]);
      });

      it('should update template category order - move middle item before first', async () => {
        // Create 3 categories
        const cat1 = await createTemplateCategory({ name: 'category1' });
        const cat2 = await createTemplateCategory({ name: 'category2' });
        const cat3 = await createTemplateCategory({ name: 'category3' });

        // Initial order: [cat1, cat2, cat3]
        // Move cat2 before cat1
        await updateTemplateCategoryOrder({
          templateCategoryId: cat2.data.id,
          anchorId: cat1.data.id,
          position: 'before',
        });

        // Expected order: [cat2, cat1, cat3]
        const updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat2.data.id,
          cat1.data.id,
          cat3.data.id,
        ]);
      });

      it('should update template category order - complex reordering', async () => {
        // Create 5 categories
        const cat1 = await createTemplateCategory({ name: 'category1' });
        const cat2 = await createTemplateCategory({ name: 'category2' });
        const cat3 = await createTemplateCategory({ name: 'category3' });
        const cat4 = await createTemplateCategory({ name: 'category4' });
        const cat5 = await createTemplateCategory({ name: 'category5' });

        // Initial order: [cat1, cat2, cat3, cat4, cat5]
        const initialList = await getTemplateCategoryList();
        expect(initialList.data.map(({ id }) => id)).toEqual([
          cat1.data.id,
          cat2.data.id,
          cat3.data.id,
          cat4.data.id,
          cat5.data.id,
        ]);

        // Move cat5 before cat2
        await updateTemplateCategoryOrder({
          templateCategoryId: cat5.data.id,
          anchorId: cat2.data.id,
          position: 'before',
        });

        // Expected order: [cat1, cat5, cat2, cat3, cat4]
        let updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat1.data.id,
          cat5.data.id,
          cat2.data.id,
          cat3.data.id,
          cat4.data.id,
        ]);

        // Move cat1 after cat4
        await updateTemplateCategoryOrder({
          templateCategoryId: cat1.data.id,
          anchorId: cat4.data.id,
          position: 'after',
        });

        // Expected order: [cat5, cat2, cat3, cat4, cat1]
        updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat5.data.id,
          cat2.data.id,
          cat3.data.id,
          cat4.data.id,
          cat1.data.id,
        ]);
      });

      it('should handle adjacent category reordering', async () => {
        // Create 3 categories
        const cat1 = await createTemplateCategory({ name: 'category1' });
        const cat2 = await createTemplateCategory({ name: 'category2' });
        const cat3 = await createTemplateCategory({ name: 'category3' });

        // Move cat2 after cat1 (already in this position, but should work)
        await updateTemplateCategoryOrder({
          templateCategoryId: cat2.data.id,
          anchorId: cat1.data.id,
          position: 'after',
        });

        // Order should remain: [cat1, cat2, cat3]
        let updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat1.data.id,
          cat2.data.id,
          cat3.data.id,
        ]);

        // Swap cat1 and cat2 by moving cat1 after cat2
        await updateTemplateCategoryOrder({
          templateCategoryId: cat1.data.id,
          anchorId: cat2.data.id,
          position: 'after',
        });

        // Expected order: [cat2, cat1, cat3]
        updatedList = await getTemplateCategoryList();
        expect(updatedList.data.map(({ id }) => id)).toEqual([
          cat2.data.id,
          cat1.data.id,
          cat3.data.id,
        ]);
      });

      it('should maintain order consistency after multiple operations', async () => {
        // Create 4 categories
        const cat1 = await createTemplateCategory({ name: 'category1' });
        const cat2 = await createTemplateCategory({ name: 'category2' });
        const cat3 = await createTemplateCategory({ name: 'category3' });
        const cat4 = await createTemplateCategory({ name: 'category4' });

        // Perform multiple reordering operations
        await updateTemplateCategoryOrder({
          templateCategoryId: cat4.data.id,
          anchorId: cat1.data.id,
          position: 'before',
        });
        // Order: [cat4, cat1, cat2, cat3]

        await updateTemplateCategoryOrder({
          templateCategoryId: cat2.data.id,
          anchorId: cat4.data.id,
          position: 'before',
        });
        // Order: [cat2, cat4, cat1, cat3]

        await updateTemplateCategoryOrder({
          templateCategoryId: cat3.data.id,
          anchorId: cat2.data.id,
          position: 'after',
        });
        // Order: [cat2, cat3, cat4, cat1]

        const finalList = await getTemplateCategoryList();
        expect(finalList.data.map(({ id }) => id)).toEqual([
          cat2.data.id,
          cat3.data.id,
          cat4.data.id,
          cat1.data.id,
        ]);
      });
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

  describe('Template Permalink', () => {
    let templateId: string;
    let snapshotBaseId: string;

    beforeEach(async () => {
      // Create a base with a table
      await createTable(baseId, {
        name: 'Test Table',
      });

      // Create and publish a template
      const template = await createTemplate({
        name: 'Test Permalink Template',
        description: 'Template for testing permalink',
      });
      templateId = template.data.id;

      // Link template to base
      await updateTemplate(templateId, {
        baseId: baseId,
      });

      // Create snapshot
      await createTemplateSnapshot(templateId);

      // Get snapshot baseId from template
      const updatedTemplate = await prismaService.txClient().template.findUnique({
        where: { id: templateId },
        select: { snapshot: true },
      });
      const snapshot = updatedTemplate?.snapshot
        ? JSON.parse(updatedTemplate.snapshot as string)
        : {};
      snapshotBaseId = snapshot.baseId;

      // Publish the template
      await updateTemplate(templateId, {
        isPublished: true,
      });
    });

    it('should resolve permalink and return redirect URL', async () => {
      const result = await getTemplatePermalink(templateId);

      expect(result.status).toBe(200);
      expect(result.data).toBeDefined();
      expect(result.data.redirectUrl).toBeDefined();
      expect(typeof result.data.redirectUrl).toBe('string');
      // Should redirect to the snapshot base
      expect(result.data.redirectUrl).toContain('/base/');
      expect(result.data.redirectUrl).toContain(snapshotBaseId);
    });

    it('should return 404 for non-existent template', async () => {
      const fakeTemplateId = 'tplxxxxxxxxxxxxxx';
      await expect(getTemplatePermalink(fakeTemplateId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('should return error for unpublished template', async () => {
      // Create a separate base for this template to avoid unique constraint error
      const unpublishedBase = await createBase({
        name: 'Unpublished Template Base',
        spaceId,
      });

      // Create an unpublished template
      const unpublishedTemplate = await createTemplate({
        name: 'Unpublished Template',
      });

      await updateTemplate(unpublishedTemplate.data.id, {
        baseId: unpublishedBase.data.id,
      });

      await createTemplateSnapshot(unpublishedTemplate.data.id);

      await expect(getTemplatePermalink(unpublishedTemplate.data.id)).rejects.toMatchObject({
        status: 403,
      });

      // Cleanup
      await deleteBase(unpublishedBase.data.id);
    });

    it('should return custom defaultUrl when publishInfo exists', async () => {
      // Update template with custom publishInfo
      const customUrl = `/base/${snapshotBaseId}/table/tblxxxxxx/viwxxxxxx`;
      await prismaService.txClient().template.update({
        where: { id: templateId },
        data: {
          publishInfo: {
            defaultUrl: customUrl,
          },
        },
      });

      const result = await getTemplatePermalink(templateId);

      expect(result.status).toBe(200);
      expect(result.data.redirectUrl).toBe(customUrl);
    });

    it('should return error for invalid identifier format', async () => {
      const invalidId = 'invalid-id-format';
      await expect(getTemplatePermalink(invalidId)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('should cache permalink results', async () => {
      // First call
      const result1 = await getTemplatePermalink(templateId);
      expect(result1.status).toBe(200);

      // Second call (should hit cache)
      const result2 = await getTemplatePermalink(templateId);
      expect(result2.status).toBe(200);
      expect(result2.data.redirectUrl).toBe(result1.data.redirectUrl);
    });

    it('should handle template without publishInfo gracefully', async () => {
      // Create a separate base for this template to avoid unique constraint error
      const simpleBase = await createBase({
        name: 'Simple Template Base',
        spaceId,
      });

      // Create template without publishInfo
      const simpleTemplate = await createTemplate({
        name: 'Simple Template',
      });

      await updateTemplate(simpleTemplate.data.id, {
        baseId: simpleBase.data.id,
      });

      await createTemplateSnapshot(simpleTemplate.data.id);

      // Get snapshot baseId from template
      const updatedTemplate = await prismaService.txClient().template.findUnique({
        where: { id: simpleTemplate.data.id },
        select: { snapshot: true },
      });
      const snapshot = updatedTemplate?.snapshot
        ? JSON.parse(updatedTemplate.snapshot as string)
        : {};
      const simpleSnapshotBaseId = snapshot.baseId;

      await updateTemplate(simpleTemplate.data.id, {
        isPublished: true,
      });

      const result = await getTemplatePermalink(simpleTemplate.data.id);

      expect(result.status).toBe(200);
      expect(result.data.redirectUrl).toBe(`/base/${simpleSnapshotBaseId}`);

      // Cleanup
      await deleteBase(simpleBase.data.id);
    });
  });
});
