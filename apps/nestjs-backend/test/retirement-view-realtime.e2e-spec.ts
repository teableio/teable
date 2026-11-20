import { isDeepStrictEqual } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { FieldType, IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { deleteFields, updateViewOptions } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { ViewColumnMetaUpdated, v2CoreTokens, type IEventBus } from '@teable/v2-core';
import type { Connection, Doc } from 'sharedb/lib/client';
import { BatchService } from '../src/features/calculation/batch.service';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import { failOnRetiredEntry } from './utils/fail-on-retired-entry';
import {
  convertField,
  createTable,
  getFields,
  getView,
  initApp,
  permanentDeleteTable,
  updateViewFilter,
  updateViewColumnMeta,
} from './utils/init-app';
import { subscribeDocs, waitFor } from './utils/wait';

describe.runIf(process.env.FORCE_V2_ALL === 'true')(
  'A11 view side effects after legacy raw view writes retire (real HTTP and ShareDB)',
  () => {
    let app: INestApplication;
    let cookie: string;
    let prisma: PrismaService;
    let shareDb: ShareDbService;
    let table: ITableFullVo;
    const baseId = globalThis.testConfig.baseId;

    beforeAll(async () => {
      const context = await initApp();
      app = context.app;
      cookie = context.cookie;
      prisma = app.get(PrismaService);
      shareDb = app.get(ShareDbService);
    });

    afterAll(async () => {
      await app.close();
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    const connectView = async (viewId: string) => {
      const connection: Connection = shareDb.connect(undefined, {
        url: `ws://localhost:${process.env.PORT}/socket`,
        headers: { cookie },
      });
      const errors: unknown[] = [];
      connection.on('error', (error: unknown) => errors.push(error));
      const doc: Doc<Record<string, unknown>> = connection.get(
        `${IdPrefix.View}_${table.id}`,
        viewId
      );
      try {
        await subscribeDocs([doc]);
      } catch (error) {
        connection.close();
        throw error;
      }
      const pushedOps: unknown[] = [];
      doc.on('op', (op: unknown) => pushedOps.push(op));
      return { connection, doc, errors, pushedOps };
    };

    // Other document types still have legacy protocol writers. Poison only the
    // retired view writer, leaving those unrelated retained entries operational.
    const retireViewRawWrites = () =>
      failOnRetiredEntry(
        BatchService.prototype,
        'saveRawOps',
        ([, , docType]) => docType === IdPrefix.View
      );

    it('persists conversion filter cleanup and pushes it to an already subscribed view', async () => {
      table = await createTable(baseId, {
        name: 'retirement conversion view',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
        ],
        records: [{ fields: { Name: 'keep', Amount: 2 } }],
      });
      const [name, amount] = table.fields;
      const viewId = table.views[0].id;
      const retainedCondition = { fieldId: name.id, operator: 'is', value: 'keep' };
      // Fixture preparation deliberately precedes retirement.
      await updateViewFilter(table.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: amount.id, operator: 'isGreater', value: 1 }, retainedCondition],
        },
      });
      const before = await prisma.view.findUniqueOrThrow({ where: { id: viewId } });
      const socket = await connectView(viewId);
      const restore = retireViewRawWrites();
      try {
        expect(socket.doc.data?.filter).toMatchObject({ filterSet: expect.any(Array) });
        await convertField(table.id, amount.id, { type: FieldType.SingleLineText });
        const expectedFilter = { conjunction: 'and', filterSet: [retainedCondition] };
        const stored = await prisma.view.findUniqueOrThrow({ where: { id: viewId } });
        expect(JSON.parse(stored.filter!)).toEqual(expectedFilter);
        expect(stored.version).toBeGreaterThan(before.version);
        expect((await getView(table.id, viewId)).filter).toEqual(expectedFilter);
        expect((await getFields(table.id)).find(({ id }) => id === amount.id)?.type).toBe(
          FieldType.SingleLineText
        );
        try {
          await waitFor(() => isDeepStrictEqual(socket.doc.data?.filter, expectedFilter));
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify({
              viewId,
              persistedVersion: stored.version,
              socketVersion: socket.doc.version,
              socketData: socket.doc.data,
              ops: socket.pushedOps,
              errors: socket.errors.map((item) => (item instanceof Error ? item.message : item)),
            })}`
          );
        }
        expect(socket.pushedOps.length).toBeGreaterThan(0);
        expect(socket.errors).toEqual([]);
      } finally {
        restore();
        socket.connection.close();
      }
    });

    it('uses the native aggregate frozen boundary for sparse order and multiple deleted fields', async () => {
      table = await createTable(baseId, {
        name: 'retirement frozen view',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Survivor', type: FieldType.SingleLineText },
          { name: 'Deleted neighbor', type: FieldType.SingleLineText },
          { name: 'Frozen', type: FieldType.SingleLineText },
          { name: 'Unfrozen', type: FieldType.SingleLineText },
        ],
        records: [],
      });
      const [primary, survivor, neighbor, frozen, unfrozen] = table.fields;
      const viewId = table.views[0].id;
      await updateViewColumnMeta(table.id, viewId, [
        { fieldId: primary.id, columnMeta: { order: 0 } },
        { fieldId: survivor.id, columnMeta: { order: 0.5 } },
        { fieldId: neighbor.id, columnMeta: { order: 2 } },
        { fieldId: frozen.id, columnMeta: { order: 10 } },
        { fieldId: unfrozen.id, columnMeta: { order: 50 } },
      ]);
      await updateViewOptions(table.id, viewId, { options: { frozenFieldId: frozen.id } });
      const before = await getView(table.id, viewId);
      expect(before.columnMeta).toMatchObject({
        [survivor.id]: { order: 0.5 },
        [frozen.id]: { order: 10 },
      });
      const socket = await connectView(viewId);
      const container = await app.get(V2ContainerService).getContainerForTable(table.id);
      const eventBus = container.resolve<IEventBus>(v2CoreTokens.eventBus);
      const publishSpy = vi.spyOn(eventBus, 'publishMany');
      const restore = retireViewRawWrites();
      try {
        expect(socket.doc.data?.options).toMatchObject({ frozenFieldId: frozen.id });
        await deleteFields(table.id, [neighbor.id, frozen.id]);
        const persisted = await prisma.view.findUniqueOrThrow({ where: { id: viewId } });
        const persistedOptions: unknown = JSON.parse(persisted.options!);
        expect(persistedOptions).toMatchObject({ frozenFieldId: survivor.id });
        expect((await getView(table.id, viewId)).options).toEqual(persistedOptions);
        try {
          await waitFor(() => {
            const options = socket.doc.data?.options;
            return (
              typeof options === 'object' &&
              options !== null &&
              'frozenFieldId' in options &&
              options.frozenFieldId === survivor.id
            );
          });
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify({
              viewId,
              persistedVersion: persisted.version,
              socketVersion: socket.doc.version,
              socketData: socket.doc.data,
              ops: socket.pushedOps,
              errors: socket.errors.map((item) => (item instanceof Error ? item.message : item)),
              events: publishSpy.mock.calls.flatMap(([, events]) => events),
            })}`
          );
        }
        expect(socket.doc.data?.options).toEqual(persistedOptions);
        const boundaryEvents = publishSpy.mock.calls
          .flatMap(([, events]) => events)
          .filter(
            (event): event is ViewColumnMetaUpdated =>
              event instanceof ViewColumnMetaUpdated &&
              event.viewId.toString() === viewId &&
              event.optionsChange !== undefined
          );
        expect(boundaryEvents).toHaveLength(1);
        expect(boundaryEvents[0].optionsChange).toEqual({
          previousOptions: before.options,
          nextOptions: persistedOptions,
        });
        expect((await getFields(table.id)).map(({ id }) => id)).toEqual([
          primary.id,
          survivor.id,
          unfrozen.id,
        ]);
        for (const fieldId of [neighbor.id, frozen.id]) {
          expect(await prisma.field.findUniqueOrThrow({ where: { id: fieldId } })).toMatchObject({
            deletedTime: expect.any(Date),
          });
        }
        expect(socket.pushedOps.length).toBeGreaterThan(0);
        expect(socket.errors).toEqual([]);
      } finally {
        restore();
        publishSpy.mockRestore();
        socket.connection.close();
      }
    });
  }
);
