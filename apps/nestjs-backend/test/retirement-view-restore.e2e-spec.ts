import type { INestApplication } from '@nestjs/common';
import { FieldType, IdPrefix, ViewType, type IViewVo } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  deleteView,
  enableShareView,
  getTrashItems,
  ResourceType,
  restoreTrash,
  updateViewOptions,
  updateViewShareMeta,
  type ITableFullVo,
} from '@teable/openapi';
import {
  ActorId,
  ApplyViewSnapshotCommand,
  RestoreViewCommand,
  ViewCreated,
  v2CoreTokens,
  type ICommandBus,
  type IDomainEvent,
  type IEventBus,
  type RestoreViewResult,
} from '@teable/v2-core';
import type { Connection, Doc } from 'sharedb/lib/client';
import { BatchService } from '../src/features/calculation/batch.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import { failOnRetiredEntry } from './utils/fail-on-retired-entry';
import {
  createTable,
  createView,
  getView,
  initApp,
  permanentDeleteTable,
  updateViewColumnMeta,
  updateViewFilter,
} from './utils/init-app';
import { subscribeDocs, waitFor } from './utils/wait';

describe.runIf(process.env.FORCE_V2_ALL === 'true')(
  'A11 trusted view trash restoration (real persistence and ShareDB)',
  () => {
    let app: INestApplication;
    let cookie: string;
    let prisma: PrismaService;
    let table: ITableFullVo;
    const baseId = globalThis.testConfig.baseId;

    beforeAll(async () => {
      const context = await initApp();
      app = context.app;
      cookie = context.cookie;
      prisma = app.get(PrismaService);
    });

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'native retained view restore',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    afterAll(async () => {
      await app.close();
    });

    const connectView = async (viewId: string) => {
      const connection: Connection = app.get(ShareDbService).connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const errors: unknown[] = [];
      connection.on('error', (error: unknown) => errors.push(error));
      const doc: Doc<IViewVo> = connection.get(`${IdPrefix.View}_${table.id}`, viewId);
      try {
        await subscribeDocs([doc]);
      } catch (error) {
        connection.close();
        throw error;
      }
      const creates: unknown[] = [];
      const ops: unknown[] = [];
      const deletes: unknown[] = [];
      doc.on('op', (op: unknown) => ops.push(op));
      doc.on('del', (source: unknown) => deletes.push(source));
      doc.on('create', (source: unknown) => creates.push(source));
      return { connection, doc, creates, deletes, ops, errors };
    };

    const prepareSharedView = async () => {
      const view = await createView(table.id, {
        name: 'Retained shared view',
        type: ViewType.Grid,
      });
      const fieldId = table.fields[0].id;
      await updateViewFilter(table.id, view.id, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId, operator: 'isNotEmpty', value: null }],
        },
      });
      await updateViewColumnMeta(table.id, view.id, [
        { fieldId, columnMeta: { order: 0.5, width: 173 } },
      ]);
      await updateViewOptions(table.id, view.id, { options: { frozenFieldId: fieldId } });
      await enableShareView({ tableId: table.id, viewId: view.id });
      await updateViewShareMeta(table.id, view.id, {
        password: 'retained-password',
        allowCopy: true,
      });
      return getView(table.id, view.id);
    };

    it('restores native deletion through HTTP trash with original share state and a real create push', async () => {
      const original = await prepareSharedView();
      const retained = await prisma.view.findUniqueOrThrow({ where: { id: original.id } });
      const subscriber = await connectView(original.id);
      const poison = retireViewRawWrites();
      const container = await app.get(V2ContainerService).getContainerForTable(table.id);
      const eventBus = container.resolve<IEventBus>(v2CoreTokens.eventBus);
      const published: IDomainEvent[] = [];
      const publishMany = eventBus.publishMany.bind(eventBus);
      const publishedSpy = vi
        .spyOn(eventBus, 'publishMany')
        .mockImplementation(async (context, events) => {
          published.push(...events);
          return publishMany(context, events);
        });
      try {
        await deleteView(table.id, original.id);
        await waitFor(() => subscriber.doc.type === null);
        let trashId: string | undefined;
        for (let attempt = 0; attempt < 100 && !trashId; attempt++) {
          const items = (
            await getTrashItems({ resourceId: table.id, resourceType: ResourceType.Table })
          ).data.trashItems;
          trashId = items.find(
            (item) => 'resourceIds' in item && item.resourceIds.includes(original.id)
          )?.id;
          if (!trashId) {
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve, 50);
            await promise;
          }
        }
        expect(trashId).toBeDefined();
        await restoreTrash(trashId!, table.id);
        const restored = await getView(table.id, original.id);
        expect(restored).toMatchObject({
          id: original.id,
          name: original.name,
          order: original.order,
          filter: original.filter,
          columnMeta: original.columnMeta,
          options: original.options,
          enableShare: true,
          shareId: original.shareId,
          shareMeta: original.shareMeta,
        });
        const row = await prisma.view.findUniqueOrThrow({ where: { id: original.id } });
        expect(row.version).toBe(retained.version + 2);
        expect(row.createdTime).toEqual(retained.createdTime);
        expect(row.deletedTime).toBeNull();
        try {
          await waitFor(() => Boolean(subscriber.doc.data?.shareId));
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify({
              viewId: original.id,
              retainedVersion: retained.version,
              persistedVersion: row.version,
              deletedTime: row.deletedTime,
              socketVersion: subscriber.doc.version,
              socketType: subscriber.doc.type,
              socketData: subscriber.doc.data,
              creates: subscriber.creates,
              deletes: subscriber.deletes,
              ops: subscriber.ops,
              events: published.map((event) => ({
                name: event.name,
                ...(event instanceof ViewCreated
                  ? {
                      viewId: event.viewId.toString(),
                      oldVersion: event.oldVersion,
                      newVersion: event.newVersion,
                    }
                  : {}),
              })),
              errors: subscriber.errors.map((item) =>
                item instanceof Error ? item.message : item
              ),
            })}`
          );
        }
        expect(subscriber.doc.data).toMatchObject({
          id: original.id,
          shareId: original.shareId,
          shareMeta: original.shareMeta,
        });
        expect(subscriber.creates).toHaveLength(1);
        expect(subscriber.doc.version).toBe(row.version);
        await updateViewColumnMeta(table.id, original.id, [
          { fieldId: table.fields[0].id, columnMeta: { width: 191 } },
        ]);
        await waitFor(() => subscriber.doc.data?.columnMeta[table.fields[0].id]?.width === 191);
        expect(subscriber.doc.version).toBe(
          (await prisma.view.findUniqueOrThrow({ where: { id: original.id } })).version
        );
        expect(subscriber.errors).toEqual([]);
      } finally {
        publishedSpy.mockRestore();
        poison();
        subscriber.connection.close();
      }
    });

    const retireViewRawWrites = () =>
      failOnRetiredEntry(
        BatchService.prototype,
        'saveRawOps',
        ([, , docType]) => docType === IdPrefix.View
      );

    it('serializes concurrent real restore commands without overwriting the winning view or publishing twice', async () => {
      const original = await prepareSharedView();
      const row = await prisma.view.findUniqueOrThrow({ where: { id: original.id } });
      const subscriber = await connectView(original.id);
      const poison = retireViewRawWrites();
      try {
        await deleteView(table.id, original.id);
        await waitFor(() => subscriber.doc.type === null);
        const container = await app.get(V2ContainerService).getContainerForTable(table.id);
        const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
        const eventBus = container.resolve<IEventBus>(v2CoreTokens.eventBus);
        const published: IDomainEvent[] = [];
        const publishMany = eventBus.publishMany.bind(eventBus);
        const spy = vi
          .spyOn(eventBus, 'publishMany')
          .mockImplementation(async (context, events) => {
            published.push(...events);
            return publishMany(context, events);
          });
        try {
          const actor = ActorId.create(row.createdBy);
          if (actor.isErr()) throw new Error(actor.error.message);
          const command = RestoreViewCommand.create({ tableId: table.id, viewId: original.id });
          if (command.isErr()) throw new Error(command.error.message);
          const context = { actorId: actor.value };
          const results = await Promise.all([
            commandBus.execute<RestoreViewCommand, RestoreViewResult>(context, command.value),
            commandBus.execute<RestoreViewCommand, RestoreViewResult>(context, command.value),
          ]);
          expect(results.filter((result) => result.isOk())).toHaveLength(1);
          const failure = results.find((result) => result.isErr());
          if (!failure?.isErr()) throw new Error('Expected the concurrent restore to fail');
          expect(failure.error.code).toBe('view.already_exists');
          await waitFor(() => Boolean(subscriber.doc.data?.shareId));
          expect(published.filter((event) => event instanceof ViewCreated)).toHaveLength(1);
          expect(subscriber.creates).toHaveLength(1);
          const restored = await prisma.view.findUniqueOrThrow({ where: { id: original.id } });
          expect(restored.version).toBe(row.version + 2);
          expect(restored.shareId).toBe(row.shareId);
          expect(restored.shareMeta).toBe(row.shareMeta);
          expect(subscriber.errors).toEqual([]);
        } finally {
          spy.mockRestore();
        }
      } finally {
        poison();
        subscriber.connection.close();
      }
    });

    it('keeps ordinary snapshot replay from restoring stale sharing credentials', async () => {
      const original = await prepareSharedView();
      const retained = await prisma.view.findUniqueOrThrow({ where: { id: original.id } });
      const shareMeta = JSON.parse(retained.shareMeta ?? 'null');
      expect(shareMeta).toMatchObject({ password: expect.any(String), allowCopy: true });
      const container = await app.get(V2ContainerService).getContainerForTable(table.id);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const actor = ActorId.create(retained.createdBy);
      if (actor.isErr()) throw new Error(actor.error.message);
      const command = ApplyViewSnapshotCommand.create({
        tableId: table.id,
        snapshot: {
          id: original.id,
          name: original.name,
          type: original.type,
          order: original.order,
          properties: { enableShare: true, shareId: original.shareId, shareMeta },
          columnMeta: original.columnMeta,
          query: {},
          sourceFilter: original.filter,
          options: original.options,
        },
      });
      if (command.isErr()) throw new Error(command.error.message);
      // Simulate credentials revoked after this history snapshot was captured.
      await prisma.view.update({
        where: { id: original.id },
        data: { enableShare: false, shareId: null, shareMeta: null },
      });
      const result = await commandBus.execute({ actorId: actor.value }, command.value);
      if (result.isErr()) throw new Error(result.error.message);
      const after = await prisma.view.findUniqueOrThrow({ where: { id: original.id } });
      expect(after.enableShare).toBe(false);
      expect(after.shareId).toBeNull();
      expect(JSON.parse(after.shareMeta ?? 'null')).toEqual({ allowCopy: true });
    });
  }
);
