/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createBase,
  createSpace,
  createTemplate,
  createTemplateSnapshot,
  deleteBase,
  getBaseById,
  getTemplateDetail,
  updateTemplate,
} from '@teable/openapi';
import { deleteSpace, initApp } from './utils/init-app';

describe('Template Open API Controller (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  const spaceId = globalThis.testConfig.spaceId;
  let baseId: string;
  let templateSpaceId: string;
  let templateBaseId: string;

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
    templateBaseId = await getTemplateDetail(template.data.id).then(
      (res) => res.data.snapshot.baseId!
    );
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

  it('should get getBaseById', async () => {
    const res = await getBaseById(templateBaseId);
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(templateBaseId);
  });
});
