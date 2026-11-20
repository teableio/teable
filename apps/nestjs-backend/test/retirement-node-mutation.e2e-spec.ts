import type { INestApplication } from '@nestjs/common';
import { FieldType, IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { getBaseNodeTree, updateBaseNode, UPDATE_BASE_NODE, urlBuilder } from '@teable/openapi';
import type { Connection, Doc } from 'sharedb/lib/client';
import { TableOpenApiService } from '../src/features/table/open-api/table-open-api.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { failOnRetiredEntry } from './utils/fail-on-retired-entry';
import { createTable, getTable, initApp, permanentDeleteTable } from './utils/init-app';
import { subscribeDocs, waitFor } from './utils/wait';

describe.runIf(process.env.FORCE_V2_ALL === 'true')(
  'A16 table node mutation after legacy table writes retire (real HTTP and ShareDB)',
  () => {
    let app: INestApplication;
    let cookie: string;
    const baseId = globalThis.testConfig.baseId;

    beforeAll(async () => {
      const context = await initApp();
      app = context.app;
      cookie = context.cookie;
    });

    afterAll(async () => {
      await app.close();
    });

    it('renames and clears the icon through a node, pushes table metadata, and rejects an outsider without a write', async () => {
      const table = await createTable(baseId, {
        name: 'retirement node before',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });
      let connection: Connection | undefined;
      const restores: Array<() => void> = [];
      try {
        const node = (await getBaseNodeTree(baseId)).data.nodes.find(
          ({ resourceId }) => resourceId === table.id
        )!;
        expect(node).toBeDefined();
        await updateBaseNode(baseId, node.id, { icon: '📋' });
        const outsider = await createNewUserAxios({
          email: 'retirement-node-outsider@example.com',
          password: '12345678',
        });
        const prisma = app.get(PrismaService);
        connection = app.get(ShareDbService).connect(undefined, {
          url: `ws://localhost:${process.env.PORT}/socket`,
          headers: { cookie },
        });
        const errors: unknown[] = [];
        connection.on('error', (error: unknown) => errors.push(error));
        const doc: Doc<Record<string, unknown>> = connection.get(
          `${IdPrefix.Table}_${baseId}`,
          table.id
        );
        await subscribeDocs([doc]);
        expect(doc.data).toMatchObject({ name: table.name, icon: '📋' });
        const initialVersion = doc.version!;
        const pushedOps: unknown[] = [];
        doc.on('op', (op: unknown) => pushedOps.push(op));
        restores.push(failOnRetiredEntry(TableOpenApiService.prototype, 'updateName'));
        restores.push(failOnRetiredEntry(TableOpenApiService.prototype, 'updateIcon'));

        const renamed = await updateBaseNode(baseId, node.id, {
          name: 'retirement node after',
          icon: null,
        });
        expect(renamed.status).toBe(200);
        await waitFor(() => doc.data?.name === 'retirement node after' && doc.data?.icon === null);
        const updatedTable = await getTable(baseId, table.id);
        expect(updatedTable).toMatchObject({ name: 'retirement node after' });
        expect(updatedTable.icon).toBeUndefined();
        const committed = await prisma.tableMeta.findUniqueOrThrow({ where: { id: table.id } });
        expect(committed).toMatchObject({ name: 'retirement node after', icon: null });
        expect(doc.version!).toBeGreaterThan(initialVersion);
        expect(pushedOps.length).toBeGreaterThan(0);
        expect(
          (await getBaseNodeTree(baseId)).data.nodes.find(({ id }) => id === node.id)
        ).toMatchObject({
          resourceMeta: {
            name: 'retirement node after',
            icon: null,
          },
        });

        const committedVersion = committed.version;
        const committedSocketVersion = doc.version;
        const committedPushCount = pushedOps.length;
        await expect(
          outsider.put(urlBuilder(UPDATE_BASE_NODE, { baseId, nodeId: node.id }), {
            name: 'outsider overwrite',
            icon: '❌',
          })
        ).rejects.toMatchObject({ status: 403 });
        expect(await prisma.tableMeta.findUniqueOrThrow({ where: { id: table.id } })).toMatchObject(
          {
            name: 'retirement node after',
            icon: null,
            version: committedVersion,
          }
        );
        expect(doc.data).toMatchObject({ name: 'retirement node after', icon: null });
        expect(doc.version).toBe(committedSocketVersion);
        expect(pushedOps).toHaveLength(committedPushCount);
        expect(errors).toEqual([]);
      } finally {
        restores.reverse().forEach((restore) => restore());
        connection?.close();
        await permanentDeleteTable(baseId, table.id);
      }
    });
  }
);
