import type { INestApplication } from '@nestjs/common';
import { FieldType, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  BaseNodeResourceType,
  createBase,
  createBaseNode,
  createSpace,
  deleteBase,
  publishBase,
} from '@teable/openapi';
import { deleteSpace, initApp } from './utils/init-app';

/**
 * The "Publish nodes" selector (PublishBaseDialog / node-tree-check.ts) relies on the
 * publish endpoint expanding every submitted node to its whole subtree and adding its
 * ancestors back. These cases pin that contract with the payloads the selector sends.
 *
 * parent (folder)
 *   ├── childA (folder) ── tableA
 *   └── childB (folder) ── tableB
 * other (table)
 */
describe('Template publish nodes (e2e)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let spaceId: string;
  let baseId: string;
  let ids: Record<'parent' | 'childA' | 'childB' | 'tableA' | 'tableB' | 'other', string>;

  const createTable = (name: string, parentId?: string) =>
    createBaseNode(baseId, {
      resourceType: BaseNodeResourceType.Table,
      name,
      parentId,
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      views: [{ name: 'Grid view', type: ViewType.Grid }],
    }).then((res) => res.data.id);

  const createFolder = (name: string, parentId?: string) =>
    createBaseNode(baseId, { resourceType: BaseNodeResourceType.Folder, name, parentId }).then(
      (res) => res.data.id
    );

  const publishAndListNodeNames = async (nodes: string[]) => {
    const { data } = await publishBase(baseId, {
      title: 'Publish nodes template',
      description: 'T6839',
      nodes,
    });
    // the snapshot base lives in the template space, which the test user cannot open
    const prisma = prismaService.txClient();
    const snapshotNodes = await prisma.baseNode.findMany({
      where: { baseId: data.baseId },
      select: { resourceId: true },
    });
    const resourceIds = snapshotNodes.map((node) => node.resourceId);
    const [folders, tables] = await Promise.all([
      prisma.baseNodeFolder.findMany({
        where: { id: { in: resourceIds } },
        select: { name: true },
      }),
      prisma.tableMeta.findMany({
        where: { id: { in: resourceIds }, deletedTime: null },
        select: { name: true },
      }),
    ]);
    expect(folders.length + tables.length).toBe(snapshotNodes.length);
    return [...folders, ...tables].map(({ name }) => name).sort();
  };

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    prismaService = app.get(PrismaService);
    spaceId = (await createSpace({ name: 'Template Publish Nodes Space' })).data.id;
  });

  afterAll(async () => {
    await deleteSpace(spaceId);
    await app.close();
  });

  beforeEach(async () => {
    baseId = (await createBase({ name: 'Template Publish Nodes Base', spaceId })).data.id;
    const parent = await createFolder('parent');
    const childA = await createFolder('childA', parent);
    const childB = await createFolder('childB', parent);
    ids = {
      parent,
      childA,
      childB,
      tableA: await createTable('tableA', childA),
      tableB: await createTable('tableB', childB),
      other: await createTable('other'),
    };
  });

  afterEach(async () => {
    await prismaService.txClient().template.deleteMany({ where: { baseId } });
    await deleteBase(baseId);
  });

  it('publishes only the checked branch after unchecking a parent and re-checking one table', async () => {
    // what the selector submits: the partially selected parent is left out
    const names = await publishAndListNodeNames([ids.other, ids.childA, ids.tableA]);

    // parent comes back as an ancestor for structure; childB/tableB must not be published
    expect(names).toEqual(['childA', 'other', 'parent', 'tableA']);
  });

  it('publishes nothing under a parent folder that was fully unchecked', async () => {
    const names = await publishAndListNodeNames([ids.other]);

    expect(names).toEqual(['other']);
  });

  it('expands a submitted folder to its whole subtree, so a partial folder must not be sent', async () => {
    const names = await publishAndListNodeNames([ids.parent, ids.childA, ids.tableA]);

    expect(names).toEqual(['childA', 'childB', 'parent', 'tableA', 'tableB']);
  });
});
