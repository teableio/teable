/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';

import type {
  IColumn,
  IFieldRo,
  IFieldVo,
  IFormColumn,
  IFormColumnMeta,
  ILinkFieldOptions,
  IPluginViewOptions,
  IViewRo,
} from '@teable/core';
import {
  ColorConfigType,
  Colors,
  FieldKeyType,
  FieldType,
  generatePluginInstallId,
  generateRecordId,
  generateViewId,
  Relationship,
  RowHeightLevel,
  SortFunc,
  StatisticsFunc,
  ViewType,
} from '@teable/core';
import { PrismaService, type Prisma } from '@teable/db-main-prisma';
import type { ICreateTableRo, IRefreshShareViewVo, ITableFullVo } from '@teable/openapi';
import {
  axios,
  createShortLink,
  createPlugin,
  deletePlugin,
  disableShareView,
  updateViewFilter,
  updateViewGroup,
  updateViewOptions,
  updateViewSort,
  updateViewDescription,
  updateViewName,
  getViewFilterLinkRecords,
  updateViewShareMeta,
  enableShareView,
  updateViewColumnMeta,
  updateRecord,
  getRecords,
  getShortLink,
  updateViewLocked,
  updateViewOrder,
  updateRecordOrders,
  duplicateView,
  installViewPlugin,
  manualSortView,
  getViewInstallPlugin,
  updateViewPluginStorage,
  deleteView,
  createView as createViewApi,
  getView as getViewApi,
  getViewList as getViewListApi,
  getShareView,
  LastVisitResourceType,
  PinType,
  PluginPosition,
  publishPlugin,
  refreshViewShareId,
  ShortLinkType,
  submitPlugin,
} from '@teable/openapi';
import { sample } from 'lodash';
import { vi } from 'vitest';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { ViewOpenApiService } from '../src/features/view/open-api/view-open-api.service';
import { ViewService } from '../src/features/view/view.service';
import { x_20 } from './data-helpers/20x';
import { VIEW_DEFAULT_SHARE_META } from './data-helpers/caces/view-default-share-meta';
import { getError } from './utils/get-error';
import {
  createField,
  createRecords,
  getFields,
  getField,
  initApp,
  createView,
  permanentDeleteTable,
  createTable,
  deleteField,
  getViews,
  getView,
  getTable,
} from './utils/init-app';

const defaultViews = [
  {
    name: 'Grid view',
    type: ViewType.Grid,
  },
];

const expectNoLegacyViewEvent = (eventSpy: {
  mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> };
}) => {
  const emittedEvents = eventSpy.mock.calls.map(([event]) => event);
  expect(emittedEvents).not.toContain(Events.TABLE_VIEW_CREATE);
  expect(emittedEvents).not.toContain(Events.TABLE_VIEW_UPDATE);
  expect(emittedEvents).not.toContain(Events.TABLE_VIEW_DELETE);
  expect(emittedEvents).not.toContain(Events.OPERATION_VIEW_CREATE);
  expect(emittedEvents).not.toContain(Events.OPERATION_VIEW_UPDATE);
  expect(emittedEvents).not.toContain(Events.OPERATION_VIEW_DELETE);
};

describe('OpenAPI ViewController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;
  let prismaService: PrismaService;
  let viewService: ViewService;
  let viewOpenApiService: ViewOpenApiService;
  let eventEmitterService: EventEmitterService;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prismaService = app.get(PrismaService);
    viewService = app.get(ViewService);
    viewOpenApiService = app.get(ViewOpenApiService);
    eventEmitterService = app.get(EventEmitterService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    const result = await permanentDeleteTable(baseId, table.id);
    console.log('clear table: ', result);
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await getViews(table.id);
    expect(viewsResult).toMatchObject(defaultViews);
  });

  it('should reject reading a view through another table', async () => {
    const anotherTable = await createTable(baseId, { name: 'another_table' });

    try {
      const [anotherView] = await getViews(anotherTable.id);

      await expect(getView(table.id, anotherView.id)).rejects.toThrow();
    } finally {
      await permanentDeleteTable(baseId, anotherTable.id);
    }
  });

  describe('Delete View v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it.each([
      [ViewType.Grid, undefined],
      [ViewType.Kanban, undefined],
      [ViewType.Gallery, undefined],
      [ViewType.Calendar, undefined],
      [ViewType.Form, undefined],
      [
        ViewType.Plugin,
        {
          pluginId: 'plgsheetform',
          pluginInstallId: 'ignored-by-create',
          pluginLogo: 'ignored-by-create',
        },
      ],
    ] as const)(
      'deletes a %s View through v2 without calling the legacy service',
      async (type, options) => {
        const created = await createViewApi(table.id, {
          name: `Delete ${type}`,
          type,
          ...(options ? { options } : {}),
        });
        const legacyDeleteSpy = vi
          .spyOn(viewOpenApiService, 'deleteView')
          .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
        const operationSpy = vi.spyOn(eventEmitterService, 'emitAsync');

        const response = await deleteView(table.id, created.data.id);

        expect(response.status).toBe(200);
        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('deleteView');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect((await getViews(table.id)).some((view) => view.id === created.data.id)).toBe(false);
        expect(legacyDeleteSpy).not.toHaveBeenCalled();
        expectNoLegacyViewEvent(operationSpy);
      }
    );

    it('cleans View last-visit and pin resources through v2 Kysely projections', async () => {
      const created = await createViewApi(table.id, {
        name: 'Delete resource cleanup',
        type: ViewType.Grid,
      });
      const viewId = created.data.id;
      await prismaService.userLastVisit.create({
        data: {
          userId: globalThis.testConfig.userId,
          resourceType: LastVisitResourceType.View,
          resourceId: viewId,
          parentResourceId: table.id,
        },
      });
      await prismaService.pinResource.create({
        data: {
          type: PinType.View,
          resourceId: viewId,
          createdBy: globalThis.testConfig.userId,
          order: 1,
        },
      });
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await deleteView(table.id, viewId);

      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('deleteView');
      await vi.waitFor(async () => {
        const [lastVisitCount, pinCount] = await Promise.all([
          prismaService.userLastVisit.count({
            where: {
              resourceId: viewId,
              resourceType: LastVisitResourceType.View,
            },
          }),
          prismaService.pinResource.count({
            where: {
              resourceId: viewId,
              type: PinType.View,
            },
          }),
        ]);
        expect({ lastVisitCount, pinCount }).toEqual({ lastVisitCount: 0, pinCount: 0 });
      });
      expectNoLegacyViewEvent(eventSpy);
    });

    it('rejects a View owned by another Table without deleting either aggregate child', async () => {
      const anotherTable = await createTable(baseId, { name: 'delete_view_other_table' });
      try {
        const sourceView = await createView(table.id, {
          name: 'Keep Source Valid',
          type: ViewType.Grid,
        });
        const anotherView = await createView(anotherTable.id, {
          name: 'Other Table View',
          type: ViewType.Grid,
        });
        const legacyDeleteSpy = vi.spyOn(viewOpenApiService, 'deleteView');

        const error = await getError(() => deleteView(table.id, anotherView.id));

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        expect((await getViews(anotherTable.id)).some((view) => view.id === anotherView.id)).toBe(
          true
        );
        expect((await getViews(table.id)).some((view) => view.id === sourceView.id)).toBe(true);
        expect(legacyDeleteSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('rejects the last View with the aggregate invariant and leaves it active', async () => {
      const [lastView] = await getViews(table.id);
      const legacyDeleteSpy = vi.spyOn(viewOpenApiService, 'deleteView');

      const error = await getError(() => deleteView(table.id, lastView.id));

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({
        domainCode: 'view.cannot_delete_last',
      });
      expect((await getViews(table.id)).map((view) => view.id)).toEqual([lastView.id]);
      expect(legacyDeleteSpy).not.toHaveBeenCalled();
    });

    it('clears an incoming symmetric Link filterByViewId in the same transaction', async () => {
      const foreignTable = await createTable(baseId, { name: 'delete_view_link_cleanup' });
      try {
        const targetView = await createView(table.id, {
          name: 'Link Filter View',
          type: ViewType.Grid,
        });
        const linkField = await createField(foreignTable.id, {
          name: 'Filtered Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table.id,
            filterByViewId: targetView.id,
          },
        });
        expect((linkField.options as ILinkFieldOptions).filterByViewId).toBe(targetView.id);

        await deleteView(table.id, targetView.id);

        const currentLinkField = await getField(foreignTable.id, linkField.id);
        expect((currentLinkField.options as ILinkFieldOptions).filterByViewId).toBeNull();
      } finally {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
    });
  });

  describe('Rename View v2 canary (T6420)', () => {
    const windowIdHeader = 'x-window-id';
    const windowId = 'rename-view-v2-window';
    let previousForceV2All: string | undefined;
    let previousWindowId = axios.defaults.headers.common[windowIdHeader];

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      previousWindowId = axios.defaults.headers.common[windowIdHeader];
      axios.defaults.headers.common[windowIdHeader] = windowId;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
      if (previousWindowId == null) {
        delete axios.defaults.headers.common[windowIdHeader];
      } else {
        axios.defaults.headers.common[windowIdHeader] = previousWindowId;
      }
    });

    it.each([
      [ViewType.Grid, undefined],
      [ViewType.Kanban, undefined],
      [ViewType.Gallery, undefined],
      [ViewType.Calendar, undefined],
      [ViewType.Form, undefined],
      [
        ViewType.Plugin,
        {
          pluginId: 'plgsheetform',
          pluginInstallId: 'ignored-by-create',
          pluginLogo: 'ignored-by-create',
        },
      ],
    ] as const)(
      'renames a %s View through the Table aggregate without calling the legacy write path',
      async (type, options) => {
        const created = await createView(table.id, {
          name: `Rename ${type}`,
          type,
          ...(options ? { options } : {}),
        });
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: created.id },
          select: { version: true, lastModifiedBy: true, lastModifiedTime: true },
        });
        const legacyPropertySpy = vi
          .spyOn(viewOpenApiService, 'setViewProperty')
          .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
        const legacyOpsSpy = vi
          .spyOn(viewService, 'updateViewByOps')
          .mockRejectedValue(new Error('legacy ViewService must not be used'));
        const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
        const nextName = `Renamed ${type}`;

        const response = await updateViewName(table.id, created.id, { name: nextName });

        expect(response.status).toBe(200);
        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewName');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect((await getView(table.id, created.id)).name).toBe(nextName);
        const rowAfter = await prismaService.view.findUniqueOrThrow({
          where: { id: created.id },
          select: { version: true, lastModifiedBy: true, lastModifiedTime: true },
        });
        expect(rowAfter.version).toBe(rowBefore.version + 1);
        expect(rowAfter.lastModifiedBy).toBe(globalThis.testConfig.userId);
        expect(rowAfter.lastModifiedTime?.getTime()).toBeGreaterThanOrEqual(
          rowBefore.lastModifiedTime?.getTime() ?? 0
        );
        expect(legacyPropertySpy).not.toHaveBeenCalled();
        expect(legacyOpsSpy).not.toHaveBeenCalled();
        expectNoLegacyViewEvent(eventSpy);
      }
    );

    it('rejects a View owned by another Table and leaves both aggregates unchanged', async () => {
      const anotherTable = await createTable(baseId, { name: 'rename_view_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

        const error = await getError(() =>
          updateViewName(table.id, anotherView.id, { name: 'Cross aggregate rename' })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        expect((await getView(table.id, sourceView.id)).name).toBe(sourceView.name);
        expect((await getView(anotherTable.id, anotherView.id)).name).toBe(anotherView.name);
        expect(legacyPropertySpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('rejects a duplicate active name through the Table uniqueness invariant', async () => {
      const firstView = (await getViews(table.id))[0]!;
      const secondView = await createView(table.id, {
        name: 'Existing view name',
        type: ViewType.Grid,
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: firstView.id },
        select: { name: true, version: true },
      });

      const error = await getError(() =>
        updateViewName(table.id, firstView.id, { name: secondView.name })
      );

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({ domainCode: 'conflict' });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: firstView.id },
          select: { name: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });

    it('preserves the accepted empty-name and unchanged-name branches', async () => {
      const view = (await getViews(table.id))[0]!;

      const emptyResponse = await updateViewName(table.id, view.id, { name: '' });
      const unchangedResponse = await updateViewName(table.id, view.id, { name: '' });

      expect(emptyResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewName');
      expect(unchangedResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewName');
      expect((await getView(table.id, view.id)).name).toBe('');
    });

    it('rejects an oversized name through the v2 View operation guard without persistence', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { name: true, version: true },
      });

      const error = await getError(() =>
        updateViewName(table.id, view.id, { name: 'x'.repeat(101) })
      );

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({
        domainCode: 'validation.limit.name_max_length',
      });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { name: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });

    it('allows only one concurrent rename from the same Table aggregate version', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { name: true, version: true },
      });
      const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');
      const results = await Promise.allSettled([
        updateViewName(table.id, view.id, { name: 'Concurrent writer A' }),
        updateViewName(table.id, view.id, { name: 'Concurrent writer B' }),
      ]);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof updateViewName>>> =>
          result.status === 'fulfilled'
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        status: 400,
        data: { domainCode: 'view.version_conflict' },
      });

      const persisted = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { name: true, version: true },
      });
      expect(['Concurrent writer A', 'Concurrent writer B']).toContain(persisted.name);
      expect(persisted.version).toBe(rowBefore.version + 1);
      expect(legacyPropertySpy).not.toHaveBeenCalled();
    });
  });

  describe('Update View Description v2 canary (T6420)', () => {
    const windowIdHeader = 'x-window-id';
    const windowId = 'update-view-description-v2-window';
    let previousForceV2All: string | undefined;
    let previousWindowId = axios.defaults.headers.common[windowIdHeader];

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      previousWindowId = axios.defaults.headers.common[windowIdHeader];
      axios.defaults.headers.common[windowIdHeader] = windowId;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
      if (previousWindowId == null) {
        delete axios.defaults.headers.common[windowIdHeader];
      } else {
        axios.defaults.headers.common[windowIdHeader] = previousWindowId;
      }
    });

    it.each([
      [ViewType.Grid, undefined],
      [ViewType.Kanban, undefined],
      [ViewType.Gallery, undefined],
      [ViewType.Calendar, undefined],
      [ViewType.Form, undefined],
      [
        ViewType.Plugin,
        {
          pluginId: 'plgsheetform',
          pluginInstallId: 'ignored-by-create',
          pluginLogo: 'ignored-by-create',
        },
      ],
    ] as const)(
      'updates a %s View description through the Table aggregate without calling the legacy write path',
      async (type, options) => {
        const previousDescription = `Before ${type}`;
        const created = await createView(table.id, {
          name: `Describe ${type}`,
          description: previousDescription,
          type,
          ...(options ? { options } : {}),
        });
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: created.id },
          select: {
            description: true,
            version: true,
            lastModifiedBy: true,
            lastModifiedTime: true,
          },
        });
        const legacyPropertySpy = vi
          .spyOn(viewOpenApiService, 'setViewProperty')
          .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
        const legacyOpsSpy = vi
          .spyOn(viewService, 'updateViewByOps')
          .mockRejectedValue(new Error('legacy ViewService must not be used'));
        const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
        const nextDescription = `After ${type}`;

        const response = await updateViewDescription(table.id, created.id, {
          description: nextDescription,
        });

        expect(response.status).toBe(200);
        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewDescription');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect((await getView(table.id, created.id)).description).toBe(nextDescription);
        const rowAfter = await prismaService.view.findUniqueOrThrow({
          where: { id: created.id },
          select: {
            description: true,
            version: true,
            lastModifiedBy: true,
            lastModifiedTime: true,
          },
        });
        expect(rowAfter.description).toBe(nextDescription);
        expect(rowAfter.version).toBe(rowBefore.version + 1);
        expect(rowAfter.lastModifiedBy).toBe(globalThis.testConfig.userId);
        expect(rowAfter.lastModifiedTime?.getTime()).toBeGreaterThanOrEqual(
          rowBefore.lastModifiedTime?.getTime() ?? 0
        );
        expect(legacyPropertySpy).not.toHaveBeenCalled();
        expect(legacyOpsSpy).not.toHaveBeenCalled();
        expectNoLegacyViewEvent(eventSpy);
      }
    );

    it('rejects a View owned by another Table and leaves both aggregates unchanged', async () => {
      const anotherTable = await createTable(baseId, {
        name: 'update_view_description_other_table',
      });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        await updateViewDescription(table.id, sourceView.id, {
          description: 'Source description',
        });
        await updateViewDescription(anotherTable.id, anotherView.id, {
          description: 'Other description',
        });
        const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

        const error = await getError(() =>
          updateViewDescription(table.id, anotherView.id, {
            description: 'Cross aggregate description',
          })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        expect((await getView(table.id, sourceView.id)).description).toBe('Source description');
        expect((await getView(anotherTable.id, anotherView.id)).description).toBe(
          'Other description'
        );
        expect(legacyPropertySpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('preserves empty and unchanged descriptions while omitting empty values from legacy reads', async () => {
      const view = (await getViews(table.id))[0]!;
      await updateViewDescription(table.id, view.id, {
        description: 'Before empty',
      });

      const emptyResponse = await updateViewDescription(table.id, view.id, {
        description: '',
      });
      const unchangedResponse = await updateViewDescription(table.id, view.id, {
        description: '',
      });

      expect(emptyResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewDescription');
      expect(unchangedResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewDescription');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { description: true },
        })
      ).resolves.toEqual({ description: '' });
      expect((await getView(table.id, view.id)).description).toBeUndefined();
    });

    it('updates a previously missing description without emitting v1 View events', async () => {
      const view = (await getViews(table.id))[0]!;
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      await updateViewDescription(table.id, view.id, { description: 'First description' });

      expectNoLegacyViewEvent(eventSpy);
      expect((await getView(table.id, view.id)).description).toBe('First description');
    });

    it('rejects an oversized description through the v2 View operation guard without persistence', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { description: true, version: true },
      });

      const error = await getError(() =>
        updateViewDescription(table.id, view.id, {
          description: 'x'.repeat(2_001),
        })
      );

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({
        domainCode: 'validation.limit.description_max_length',
      });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { description: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });
  });

  describe('Update View Locked v2 canary (T6420)', () => {
    const windowIdHeader = 'x-window-id';
    const windowId = 'update-view-locked-v2-window';
    let previousForceV2All: string | undefined;
    let previousWindowId = axios.defaults.headers.common[windowIdHeader];

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      previousWindowId = axios.defaults.headers.common[windowIdHeader];
      axios.defaults.headers.common[windowIdHeader] = windowId;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
      if (previousWindowId == null) {
        delete axios.defaults.headers.common[windowIdHeader];
      } else {
        axios.defaults.headers.common[windowIdHeader] = previousWindowId;
      }
    });

    it.each([
      [ViewType.Grid, undefined],
      [ViewType.Kanban, undefined],
      [ViewType.Gallery, undefined],
      [ViewType.Calendar, undefined],
      [ViewType.Form, undefined],
      [
        ViewType.Plugin,
        {
          pluginId: 'plgsheetform',
          pluginInstallId: 'ignored-by-create',
          pluginLogo: 'ignored-by-create',
        },
      ],
    ] as const)(
      'updates a %s View locked state through the Table aggregate without calling the legacy write path',
      async (type, options) => {
        const created = await createView(table.id, {
          name: `Lock ${type}`,
          type,
          isLocked: false,
          ...(options ? { options } : {}),
        });
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: created.id },
          select: {
            isLocked: true,
            version: true,
            lastModifiedBy: true,
            lastModifiedTime: true,
          },
        });
        const legacyPropertySpy = vi
          .spyOn(viewOpenApiService, 'setViewProperty')
          .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
        const legacyOpsSpy = vi
          .spyOn(viewService, 'updateViewByOps')
          .mockRejectedValue(new Error('legacy ViewService must not be used'));
        const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

        const response = await updateViewLocked(table.id, created.id, { isLocked: true });

        expect(response.status).toBe(200);
        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewLocked');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect((await getView(table.id, created.id)).isLocked).toBe(true);
        const rowAfter = await prismaService.view.findUniqueOrThrow({
          where: { id: created.id },
          select: {
            isLocked: true,
            version: true,
            lastModifiedBy: true,
            lastModifiedTime: true,
          },
        });
        expect(rowAfter.isLocked).toBe(true);
        expect(rowAfter.version).toBe(rowBefore.version + 1);
        expect(rowAfter.lastModifiedBy).toBe(globalThis.testConfig.userId);
        expect(rowAfter.lastModifiedTime?.getTime()).toBeGreaterThanOrEqual(
          rowBefore.lastModifiedTime?.getTime() ?? 0
        );
        expect(legacyPropertySpy).not.toHaveBeenCalled();
        expect(legacyOpsSpy).not.toHaveBeenCalled();
        expectNoLegacyViewEvent(eventSpy);
      }
    );

    it('rejects a View owned by another Table and leaves both aggregates unchanged', async () => {
      const anotherTable = await createTable(baseId, {
        name: 'update_view_locked_other_table',
      });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        await updateViewLocked(table.id, sourceView.id, { isLocked: true });
        await updateViewLocked(anotherTable.id, anotherView.id, { isLocked: false });
        const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

        const error = await getError(() =>
          updateViewLocked(table.id, anotherView.id, { isLocked: true })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        expect((await getView(table.id, sourceView.id)).isLocked).toBe(true);
        expect((await getView(anotherTable.id, anotherView.id)).isLocked).toBeUndefined();
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: anotherView.id },
            select: { isLocked: true },
          })
        ).resolves.toEqual({ isLocked: false });
        expect(legacyPropertySpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('preserves true, false, omitted, and unchanged states without v1 View events', async () => {
      const view = (await getViews(table.id))[0]!;
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      await updateViewLocked(table.id, view.id, { isLocked: true });
      await updateViewLocked(table.id, view.id, { isLocked: false });
      const omittedResponse = await updateViewLocked(table.id, view.id, {});
      const unchangedResponse = await updateViewLocked(table.id, view.id, {});

      expect(omittedResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewLocked');
      expect(unchangedResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewLocked');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { isLocked: true },
        })
      ).resolves.toEqual({ isLocked: null });
      expect((await getView(table.id, view.id)).isLocked).toBeUndefined();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('rejects a non-boolean locked state before persistence without falling back to v1', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { isLocked: true, version: true },
      });
      const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

      const error = await getError(() =>
        axios.put(`/table/${table.id}/view/${view.id}/locked`, {
          isLocked: 'true',
        })
      );

      expect(error?.status).toBe(400);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { isLocked: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(legacyPropertySpy).not.toHaveBeenCalled();
    });
  });

  describe('Update View Order v2 canary (T6420)', () => {
    const windowIdHeader = 'x-window-id';
    const windowId = 'update-view-order-v2-window';
    let previousForceV2All: string | undefined;
    let previousWindowId = axios.defaults.headers.common[windowIdHeader];

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      previousWindowId = axios.defaults.headers.common[windowIdHeader];
      axios.defaults.headers.common[windowIdHeader] = windowId;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
      if (previousWindowId == null) {
        delete axios.defaults.headers.common[windowIdHeader];
      } else {
        axios.defaults.headers.common[windowIdHeader] = previousWindowId;
      }
    });

    const createThreeViews = async () => {
      const first = (await getViews(table.id))[0]!;
      const second = await createView(table.id, { name: 'Order second', type: ViewType.Grid });
      const third = await createView(table.id, { name: 'Order third', type: ViewType.Grid });
      return { first, second, third };
    };

    it('routes all before/after and boundary branches through v2 without legacy writes', async () => {
      const { first, second, third } = await createThreeViews();
      const legacyOrderSpy = vi
        .spyOn(viewOpenApiService, 'updateViewOrder')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
      const thirdBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: third.id },
        select: { order: true, version: true },
      });

      const beforeMiddle = await updateViewOrder(table.id, third.id, {
        anchorId: second.id,
        position: 'before',
      });
      expect(beforeMiddle.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(beforeMiddle.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewOrder');
      expect(beforeMiddle.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getViews(table.id)).map(({ id }) => id)).toEqual([
        first.id,
        third.id,
        second.id,
      ]);

      await updateViewOrder(table.id, third.id, {
        anchorId: first.id,
        position: 'before',
      });
      expect((await getViews(table.id)).map(({ id }) => id)).toEqual([
        third.id,
        first.id,
        second.id,
      ]);

      await updateViewOrder(table.id, third.id, {
        anchorId: first.id,
        position: 'after',
      });
      expect((await getViews(table.id)).map(({ id }) => id)).toEqual([
        first.id,
        third.id,
        second.id,
      ]);

      await updateViewOrder(table.id, third.id, {
        anchorId: second.id,
        position: 'after',
      });
      expect((await getViews(table.id)).map(({ id }) => id)).toEqual([
        first.id,
        second.id,
        third.id,
      ]);

      const thirdAfter = await prismaService.view.findUniqueOrThrow({
        where: { id: third.id },
        select: { order: true, version: true, lastModifiedBy: true },
      });
      expect(thirdAfter.version).toBe(thirdBefore.version + 4);
      expect(thirdAfter.lastModifiedBy).toBe(globalThis.testConfig.userId);
      expect(legacyOrderSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('keeps legacy adjacent and same-anchor behavior as real versioned updates', async () => {
      const { first, second } = await createThreeViews();
      const before = await prismaService.view.findUniqueOrThrow({
        where: { id: first.id },
        select: { order: true, version: true },
      });

      await updateViewOrder(table.id, first.id, {
        anchorId: second.id,
        position: 'before',
      });
      const adjacent = await prismaService.view.findUniqueOrThrow({
        where: { id: first.id },
        select: { order: true, version: true },
      });
      expect(adjacent.order).not.toBe(before.order);
      expect(adjacent.version).toBe(before.version + 1);

      await updateViewOrder(table.id, first.id, {
        anchorId: first.id,
        position: 'after',
      });
      const sameAnchor = await prismaService.view.findUniqueOrThrow({
        where: { id: first.id },
        select: { order: true, version: true },
      });
      expect(sameAnchor.version).toBe(adjacent.version + 1);
      expect((await getViews(table.id)).map(({ id }) => id)).toContain(first.id);
    });

    it('rejects source and anchor Views outside the Table aggregate without partial writes', async () => {
      const { first } = await createThreeViews();
      const anotherTable = await createTable(baseId, { name: 'view_order_other_table' });
      try {
        const foreignView = (await getViews(anotherTable.id))[0]!;
        const before = await prismaService.view.findMany({
          where: { tableId: table.id, deletedTime: null },
          select: { id: true, order: true, version: true },
          orderBy: { id: 'asc' },
        });
        const legacyOrderSpy = vi.spyOn(viewOpenApiService, 'updateViewOrder');

        const sourceError = await getError(() =>
          updateViewOrder(table.id, foreignView.id, {
            anchorId: first.id,
            position: 'before',
          })
        );
        const anchorError = await getError(() =>
          updateViewOrder(table.id, first.id, {
            anchorId: foreignView.id,
            position: 'after',
          })
        );

        expect(sourceError?.status).toBe(404);
        expect(sourceError?.data).toMatchObject({ domainCode: 'view.not_found' });
        expect(anchorError?.status).toBe(404);
        expect(anchorError?.data).toMatchObject({ domainCode: 'view.anchor_not_found' });
        await expect(
          prismaService.view.findMany({
            where: { tableId: table.id, deletedTime: null },
            select: { id: true, order: true, version: true },
            orderBy: { id: 'asc' },
          })
        ).resolves.toEqual(before);
        expect(legacyOrderSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('normalizes exhausted gaps inside one Table update flow and versions every affected View', async () => {
      const { first, second, third } = await createThreeViews();
      await prismaService.view.update({
        where: { id: first.id },
        data: { order: 0 },
      });
      await prismaService.view.update({
        where: { id: second.id },
        data: { order: 1 - Number.EPSILON },
      });
      await prismaService.view.update({
        where: { id: third.id },
        data: { order: 1 },
      });
      const before = await prismaService.view.findMany({
        where: { id: { in: [first.id, second.id, third.id] } },
        select: { id: true, version: true },
      });
      const versionById = new Map(before.map((row) => [row.id, row.version]));

      await updateViewOrder(table.id, first.id, {
        anchorId: third.id,
        position: 'before',
      });

      const after = await prismaService.view.findMany({
        where: { id: { in: [first.id, second.id, third.id] } },
        select: { id: true, order: true, version: true },
        orderBy: { order: 'asc' },
      });
      expect(after.map(({ id }) => id)).toEqual([second.id, first.id, third.id]);
      expect(after.find(({ id }) => id === first.id)?.version).toBe(versionById.get(first.id)! + 2);
      expect(after.find(({ id }) => id === second.id)?.version).toBe(
        versionById.get(second.id)! + 1
      );
      expect(after.find(({ id }) => id === third.id)?.version).toBe(versionById.get(third.id)! + 1);
    });
  });

  describe('Update View record order v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('routes before and after moves through the generic v2 Table contract', async () => {
      const view = (await getViews(table.id))[0]!;
      const [first, second, third] = table.records;
      const legacyOrderSpy = vi
        .spyOn(viewOpenApiService, 'updateRecordOrders')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));

      const beforeResponse = await updateRecordOrders(table.id, view.id, {
        anchorId: second!.id,
        position: 'before',
        recordIds: [third!.id],
      });

      expect(beforeResponse.status).toBe(200);
      expect(beforeResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(beforeResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('reorderRecords');
      expect(beforeResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(
        (
          await getRecords(table.id, {
            fieldKeyType: FieldKeyType.Id,
            viewId: view.id,
          })
        ).data.records.map(({ id }) => id)
      ).toEqual([first!.id, third!.id, second!.id]);

      const afterResponse = await updateRecordOrders(table.id, view.id, {
        anchorId: first!.id,
        position: 'after',
        recordIds: [third!.id, second!.id],
      });

      expect(afterResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('reorderRecords');
      expect(
        (
          await getRecords(table.id, {
            fieldKeyType: FieldKeyType.Id,
            viewId: view.id,
          })
        ).data.records.map(({ id }) => id)
      ).toEqual([first!.id, third!.id, second!.id]);
      expect(legacyOrderSpy).not.toHaveBeenCalled();
    });

    it('rejects foreign Views and missing anchors without partial reordering or v1 fallback', async () => {
      const view = (await getViews(table.id))[0]!;
      const [first, second, third] = table.records;
      const anotherTable = await createTable(baseId, { name: 'record_order_other_table' });
      const legacyOrderSpy = vi.spyOn(viewOpenApiService, 'updateRecordOrders');

      try {
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const cases = [
          () =>
            updateRecordOrders(table.id, anotherView.id, {
              anchorId: second!.id,
              position: 'before',
              recordIds: [third!.id],
            }),
          () =>
            updateRecordOrders(table.id, view.id, {
              anchorId: generateRecordId(),
              position: 'after',
              recordIds: [third!.id],
            }),
        ];

        for (const run of cases) {
          const error = await getError(run);
          expect(error?.status).toBe(404);
          expect(
            (
              await getRecords(table.id, {
                fieldKeyType: FieldKeyType.Id,
                viewId: view.id,
              })
            ).data.records.map(({ id }) => id)
          ).toEqual([first!.id, second!.id, third!.id]);
        }
        expect(legacyOrderSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('List Views v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('lists the complete subtype matrix in persisted order without using ViewService', async () => {
      const [defaultView] = await getViews(table.id);
      const createdViews = [];
      for (const type of [
        ViewType.Grid,
        ViewType.Kanban,
        ViewType.Gallery,
        ViewType.Calendar,
        ViewType.Form,
        ViewType.Plugin,
      ]) {
        createdViews.push(
          await createViewApi(table.id, {
            name: `List ${type}`,
            type,
            ...(type === ViewType.Plugin
              ? {
                  options: {
                    pluginId: 'plgsheetform',
                    pluginInstallId: 'ignored-by-create',
                    pluginLogo: 'ignored-by-create',
                  },
                }
              : {}),
          })
        );
      }
      const legacyReadSpy = vi
        .spyOn(viewService, 'getViews')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));

      const response = await getViewListApi(table.id);

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getViews');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data.map((view) => view.id)).toEqual([
        defaultView.id,
        ...createdViews.map((view) => view.data.id),
      ]);
      expect(response.data.map((view) => view.type)).toEqual([
        ViewType.Grid,
        ViewType.Grid,
        ViewType.Kanban,
        ViewType.Gallery,
        ViewType.Calendar,
        ViewType.Form,
        ViewType.Plugin,
      ]);
      expect(response.data.every((view) => Boolean(view.createdBy && view.createdTime))).toBe(true);
      expect(legacyReadSpy).not.toHaveBeenCalled();
    });

    it('preserves rich properties while omitting false and empty legacy properties', async () => {
      const primaryFieldId = table.fields[0].id;
      const rich = await createViewApi(table.id, {
        name: 'Rich list view',
        description: 'list every branch',
        type: ViewType.Grid,
        options: { rowHeight: RowHeightLevel.Tall },
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'alpha' }],
        },
        sort: {
          sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
          manualSort: false,
        },
        group: [{ fieldId: primaryFieldId, order: SortFunc.Asc }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-list-views-v2',
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          submit: { requireLogin: true },
        },
      });
      const sparse = await createViewApi(table.id, {
        name: 'Sparse list view',
        description: '',
        type: ViewType.Kanban,
        isLocked: false,
        enableShare: false,
        shareId: '',
      });

      const response = await getViewListApi(table.id);
      const richResult = response.data.find((view) => view.id === rich.data.id);
      const sparseResult = response.data.find((view) => view.id === sparse.data.id);

      expect(richResult).toMatchObject({
        name: 'Rich list view',
        description: 'list every branch',
        type: ViewType.Grid,
        options: { rowHeight: RowHeightLevel.Tall },
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'alpha' }],
        },
        sort: {
          sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
          manualSort: false,
        },
        group: [{ fieldId: primaryFieldId, order: SortFunc.Asc }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-list-views-v2',
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          submit: { requireLogin: true },
        },
      });
      expect(sparseResult?.description).toBeUndefined();
      expect(sparseResult?.isLocked).toBeUndefined();
      expect(sparseResult?.enableShare).toBeUndefined();
      expect(sparseResult?.shareId).toBeUndefined();
    });

    it('returns updated properties and optional audit metadata', async () => {
      const created = await createViewApi(table.id, {
        name: 'Updated list view',
        type: ViewType.Grid,
      });
      await updateViewDescription(table.id, created.data.id, {
        description: 'updated through legacy mutation',
      });

      const response = await getViewListApi(table.id);
      const updated = response.data.find((view) => view.id === created.data.id);

      expect(updated).toMatchObject({
        description: 'updated through legacy mutation',
      });
      expect(updated?.lastModifiedBy).toBeTruthy();
      expect(updated?.lastModifiedTime).toBeTruthy();
    });

    it('omits soft-deleted View children from the aggregate', async () => {
      const created = await createViewApi(table.id, {
        name: 'Deleted list view',
        type: ViewType.Grid,
      });
      await deleteView(table.id, created.data.id);

      const response = await getViewListApi(table.id);

      expect(response.data).not.toContainEqual(expect.objectContaining({ id: created.data.id }));
    });
  });

  describe('Get View v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('routes the complete subtype matrix through v2 without using the legacy ViewService', async () => {
      const createdViews = [];
      for (const type of [
        ViewType.Grid,
        ViewType.Kanban,
        ViewType.Gallery,
        ViewType.Calendar,
        ViewType.Form,
        ViewType.Plugin,
      ]) {
        createdViews.push(
          await createViewApi(table.id, {
            name: `Read ${type}`,
            type,
            ...(type === ViewType.Plugin
              ? {
                  options: {
                    pluginId: 'plgsheetform',
                    pluginInstallId: 'ignored-by-create',
                    pluginLogo: 'ignored-by-create',
                  },
                }
              : {}),
          })
        );
      }
      const legacyReadSpy = vi
        .spyOn(viewService, 'getViewById')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));

      for (const created of createdViews) {
        const response = await getViewApi(table.id, created.data.id);

        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getView');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(response.data).toMatchObject({
          id: created.data.id,
          name: created.data.name,
          type: created.data.type,
          columnMeta: created.data.columnMeta,
        });
        expect(response.data.createdBy).toBeTruthy();
        expect(response.data.createdTime).toBeTruthy();
      }

      expect(legacyReadSpy).not.toHaveBeenCalled();
    });

    it('returns a v2 domain error when the View does not belong to the Table', async () => {
      const anotherTable = await createTable(baseId, { name: 'another_get_view_table' });

      try {
        const [anotherView] = await getViews(anotherTable.id);
        const error = await getError(() => getViewApi(table.id, anotherView.id));

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('creates the response through the v2 query without using the legacy ViewService', async () => {
      const legacyReadSpy = vi
        .spyOn(viewService, 'getViewById')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));

      const response = await createViewApi(table.id, {
        name: 'Create response from v2 query',
        type: ViewType.Grid,
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.data).toMatchObject({
        name: 'Create response from v2 query',
        type: ViewType.Grid,
      });
      expect(legacyReadSpy).not.toHaveBeenCalled();
    });

    it('returns all persisted optional properties through the direct GET endpoint', async () => {
      const primaryFieldId = table.fields[0].id;
      const created = await createViewApi(table.id, {
        name: 'Rich GET view',
        description: 'read every branch',
        type: ViewType.Grid,
        options: { rowHeight: RowHeightLevel.Tall },
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'alpha' }],
        },
        sort: {
          sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
          manualSort: false,
        },
        group: [{ fieldId: primaryFieldId, order: SortFunc.Asc }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-get-view-v2',
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          submit: { requireLogin: true },
        },
      });

      const response = await getViewApi(table.id, created.data.id);

      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getView');
      expect(response.data).toMatchObject({
        name: 'Rich GET view',
        description: 'read every branch',
        type: ViewType.Grid,
        options: { rowHeight: RowHeightLevel.Tall },
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'alpha' }],
        },
        sort: {
          sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
          manualSort: false,
        },
        group: [{ fieldId: primaryFieldId, order: SortFunc.Asc }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-get-view-v2',
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          submit: { requireLogin: true },
        },
      });
    });

    it('omits false and empty legacy properties and removes stale column metadata', async () => {
      const primaryFieldId = table.fields[0].id;
      const staleFieldId = `fld${'z'.repeat(16)}`;
      const created = await createViewApi(table.id, {
        name: 'Sparse GET view',
        description: '',
        type: ViewType.Grid,
        isLocked: false,
        enableShare: false,
        shareId: '',
        columnMeta: {
          [primaryFieldId]: { order: 0, width: 180 },
          [staleFieldId]: { order: 1, width: 320 },
        },
      });

      const response = await getViewApi(table.id, created.data.id);

      expect(response.data.description).toBeUndefined();
      expect(response.data.isLocked).toBeUndefined();
      expect(response.data.enableShare).toBeUndefined();
      expect(response.data.shareId).toBeUndefined();
      expect(response.data.columnMeta[primaryFieldId]).toEqual({ order: 0, width: 180 });
      expect(response.data.columnMeta).not.toHaveProperty(staleFieldId);
    });

    it('returns v2 validation details for malformed identifiers', async () => {
      const error = await getError(() => getViewApi(table.id, 'invalid-view-id'));

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({ domainCode: 'validation.invalid' });
    });

    it('does not hydrate a soft-deleted View into the Table aggregate', async () => {
      const created = await createViewApi(table.id, {
        name: 'Deleted GET view',
        type: ViewType.Grid,
      });
      await deleteView(table.id, created.data.id);

      const error = await getError(() => getViewApi(table.id, created.data.id));

      expect(error?.status).toBe(404);
      expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
    });
  });

  it('/api/table/{tableId}/view (POST)', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const createdView = await createView(table.id, viewRo);

    const { dbTableName } = await prismaService.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { dbTableName: true },
    });
    const rowOrderColumn = await viewService.existIndex(
      dbTableName,
      createdView.id,
      prismaService.txClient()
    );
    expect(rowOrderColumn).toBe(`__row_${createdView.id}`);

    const result = await getViews(table.id);
    expect(result).toMatchObject([
      ...defaultViews,
      {
        name: 'New view',
        description: 'the new view',
        type: ViewType.Grid,
      },
    ]);
  });

  describe('Create View v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('routes a supported Grid payload through v2 and creates its row-order column', async () => {
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
      const response = await createViewApi(table.id, {
        name: 'V2 grid view',
        type: ViewType.Grid,
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data).toMatchObject({
        name: 'V2 grid view',
        type: ViewType.Grid,
      });

      const fields = await getFields(table.id);
      expect(Object.keys(response.data.columnMeta)).toEqual(fields.map(({ id }) => id));

      const { dbTableName } = await prismaService.tableMeta.findUniqueOrThrow({
        where: { id: table.id },
        select: { dbTableName: true },
      });
      await expect(
        viewService.existIndex(dbTableName, response.data.id, prismaService.txClient())
      ).resolves.toBe(`__row_${response.data.id}`);
      expectNoLegacyViewEvent(eventSpy);
    });

    it('applies aggregate-owned default and unique names through the HTTP API', async () => {
      const firstResponse = await createViewApi(table.id, {
        type: ViewType.Grid,
      });
      const secondResponse = await createViewApi(table.id, {
        type: ViewType.Grid,
      });

      expect(firstResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(secondResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(firstResponse.data.name).toBe('New view');
      expect(secondResponse.data.name).toBe('New view 2');

      const views = await getViews(table.id);
      expect(views.map(({ name }) => name)).toEqual(['Grid view', 'New view', 'New view 2']);
    });

    it.each(['', '  Spaced view  '])(
      'preserves the legal public name payload %j through v2',
      async (name) => {
        const response = await createViewApi(table.id, {
          name,
          type: ViewType.Grid,
        });

        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
        expect(response.data.name).toBe(name);
      }
    );

    it.each([
      {
        requestedName: 'Sprint 2',
        expectedDuplicateName: 'Sprint 3',
      },
      {
        requestedName: '123',
        expectedDuplicateName: '123 2',
      },
    ])(
      'increments duplicate name "$requestedName" as "$expectedDuplicateName"',
      async ({ requestedName, expectedDuplicateName }) => {
        const firstResponse = await createViewApi(table.id, {
          name: requestedName,
          type: ViewType.Grid,
        });
        const duplicateResponse = await createViewApi(table.id, {
          name: requestedName,
          type: ViewType.Grid,
        });

        expect(firstResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(duplicateResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(firstResponse.data.name).toBe(requestedName);
        expect(duplicateResponse.data.name).toBe(expectedDuplicateName);
      }
    );

    it('merges supported columnMeta and options while ignoring unknown fields', async () => {
      const primaryField = (await getFields(table.id))[0]!;
      const ignoredFieldId = `fld${'z'.repeat(16)}`;

      const response = await createViewApi(table.id, {
        name: 'Configured grid view',
        type: ViewType.Grid,
        columnMeta: {
          [primaryField.id]: {
            order: 12,
            width: 240,
            hidden: true,
          },
          [ignoredFieldId]: {
            order: 99,
            width: 320,
          },
        },
        options: {
          rowHeight: RowHeightLevel.Tall,
          fieldNameDisplayLines: 2,
        },
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data.options).toEqual({
        rowHeight: RowHeightLevel.Tall,
        fieldNameDisplayLines: 2,
      });
      expect(response.data.columnMeta[primaryField.id]).toEqual({
        order: 12,
        width: 240,
        hidden: true,
      });
      expect(response.data.columnMeta).not.toHaveProperty(ignoredFieldId);
    });

    it.each([ViewType.Kanban, ViewType.Gallery, ViewType.Calendar, ViewType.Form])(
      'routes %s creation through v2 without a Grid row-order column',
      async (type) => {
        const response = await createViewApi(table.id, {
          name: `V2 ${type} view`,
          type,
        });

        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(response.data).toMatchObject({
          name: `V2 ${type} view`,
          type,
        });

        const { dbTableName } = await prismaService.tableMeta.findUniqueOrThrow({
          where: { id: table.id },
          select: { dbTableName: true },
        });
        await expect(
          viewService.existIndex(dbTableName, response.data.id, prismaService.txClient())
        ).resolves.toBeUndefined();
      }
    );

    it('preserves all legacy creation properties through v2', async () => {
      const primaryFieldId = table.fields[0].id;
      const response = await createViewApi(table.id, {
        name: 'Legacy metadata grid view',
        description: 'keep this description',
        type: ViewType.Grid,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'alpha' }],
        },
        sort: {
          sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
          manualSort: false,
        },
        group: [{ fieldId: primaryFieldId, order: SortFunc.Asc }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-create-view-v2',
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          password: 'secret',
          includeRecords: true,
          allowEdit: false,
          submit: { requireLogin: true },
        },
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data).toMatchObject({
        name: 'Legacy metadata grid view',
        description: 'keep this description',
        type: ViewType.Grid,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primaryFieldId, operator: 'is', value: 'alpha' }],
        },
        sort: {
          sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
          manualSort: false,
        },
        group: [{ fieldId: primaryFieldId, order: SortFunc.Asc }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-create-view-v2',
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          password: 'secret',
          includeRecords: true,
          allowEdit: false,
          submit: { requireLogin: true },
        },
      });
    });

    it('preserves an empty legacy filter group through v2', async () => {
      const response = await createViewApi(table.id, {
        type: ViewType.Grid,
        filter: {
          conjunction: 'and',
          filterSet: [],
        },
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.data.filter).toEqual({
        conjunction: 'and',
        filterSet: [],
      });
    });

    it('accepts legacy date filters without millisecond precision through v2', async () => {
      const dateField = await createField(table.id, {
        name: 'Due',
        type: FieldType.Date,
      });
      const response = await createViewApi(table.id, {
        type: ViewType.Calendar,
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: dateField.id,
              operator: 'is',
              value: {
                mode: 'exactDate',
                exactDate: '2026-07-01T00:00:00Z',
                timeZone: 'UTC',
              },
            },
          ],
        },
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.data.filter).toEqual({
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dateField.id,
            operator: 'is',
            value: {
              mode: 'exactDate',
              exactDate: '2026-07-01T00:00:00Z',
              timeZone: 'UTC',
            },
          },
        ],
      });
    });

    it('round-trips symbol, scalar-array, and date-range filters without normalization', async () => {
      const dateField = await createField(table.id, {
        name: 'Range date',
        type: FieldType.Date,
      });
      const sourceFilter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: table.fields[0].id,
            operator: '=',
            isSymbol: true,
            value: 'alpha',
          },
          {
            fieldId: table.fields[0].id,
            operator: 'IN',
            isSymbol: true,
            value: 'alpha',
          },
          {
            fieldId: dateField.id,
            operator: 'is',
            value: {
              mode: 'dateRange' as const,
              exactDate: '2026-07-01T00:00:00.000Z',
              exactDateEnd: '2026-07-31T23:59:59.000Z',
              timeZone: 'UTC',
            },
          },
        ],
      };

      const response = await createViewApi(table.id, {
        type: ViewType.Grid,
        filter: sourceFilter,
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.data.filter).toEqual(sourceFilter);
    });

    it('applies Gallery, Calendar, and Form defaults inside the aggregate', async () => {
      const attachmentField = await createField(table.id, {
        name: 'Cover',
        type: FieldType.Attachment,
      });
      const startDateField = await createField(table.id, {
        name: 'Start',
        type: FieldType.Date,
      });
      const endDateField = await createField(table.id, {
        name: 'End',
        type: FieldType.Date,
      });
      const buttonField = await createField(table.id, {
        name: 'Action',
        type: FieldType.Button,
      });

      const gallery = await createViewApi(table.id, {
        type: ViewType.Gallery,
      });
      const calendar = await createViewApi(table.id, {
        type: ViewType.Calendar,
      });
      const form = await createViewApi(table.id, {
        type: ViewType.Form,
      });

      expect(gallery.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(calendar.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(form.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(gallery.data.options).toEqual({ coverFieldId: attachmentField.id });
      expect(calendar.data.options).toMatchObject({
        startDateFieldId: startDateField.id,
        endDateFieldId: endDateField.id,
      });
      expect(form.data.columnMeta[table.fields[0].id]).toMatchObject({ visible: true });
      expect(form.data.columnMeta[attachmentField.id]).toMatchObject({ visible: true });
      expect(form.data.columnMeta[startDateField.id]).toMatchObject({ visible: true });
      expect(form.data.columnMeta[endDateField.id]).toMatchObject({ visible: true });
      expect(form.data.columnMeta[buttonField.id]).not.toHaveProperty('visible');
    });

    it('keeps type-required columns visible when the request tries to hide them', async () => {
      const attachmentField = await createField(table.id, {
        name: 'Visible in form',
        type: FieldType.Attachment,
      });
      const primaryFieldId = table.fields[0].id;

      for (const type of [ViewType.Kanban, ViewType.Gallery, ViewType.Calendar]) {
        const response = await createViewApi(table.id, {
          type,
          columnMeta: {
            [primaryFieldId]: { order: 0, visible: false },
          },
        });

        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.data.columnMeta[primaryFieldId]).toMatchObject({ visible: true });
      }

      const form = await createViewApi(table.id, {
        type: ViewType.Form,
        columnMeta: {
          [primaryFieldId]: { order: 0, visible: false },
          [attachmentField.id]: { order: 1, visible: false },
        },
      });
      expect(form.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(form.data.columnMeta[primaryFieldId]).toMatchObject({ visible: true });
      expect(form.data.columnMeta[attachmentField.id]).toMatchObject({ visible: true });
    });

    it('creates Plugin views and their installation through the v2 transaction', async () => {
      const response = await createViewApi(table.id, {
        type: ViewType.Plugin,
        options: {
          pluginId: 'plgsheetform',
          pluginInstallId: 'ignored-by-create',
          pluginLogo: 'ignored-by-create',
        },
      });

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('createView');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data.type).toBe(ViewType.Plugin);
      expect(response.data.options).toMatchObject({
        pluginId: 'plgsheetform',
      });
      expect((response.data.options as IPluginViewOptions).pluginInstallId).not.toBe(
        'ignored-by-create'
      );
      expect((response.data.options as IPluginViewOptions).pluginLogo).not.toBe(
        'ignored-by-create'
      );

      const installation = await getViewInstallPlugin(table.id, response.data.id);
      expect(installation.data.pluginInstallId).toBe(
        (response.data.options as IPluginViewOptions).pluginInstallId
      );
    });

    it('rejects a missing Plugin through v2 without creating a View', async () => {
      const viewsBefore = await getViews(table.id);

      const error = await getError(() =>
        createViewApi(table.id, {
          type: ViewType.Plugin,
          options: {
            pluginId: 'plg-missing-view-plugin',
            pluginInstallId: 'ignored-by-create',
            pluginLogo: 'ignored-by-create',
          },
        })
      );

      expect(error?.status).toBe(404);
      expect(error?.data).toMatchObject({ domainCode: 'not_found' });
      await expect(getViews(table.id)).resolves.toHaveLength(viewsBefore.length);
    });

    it('rejects a Plugin that does not support the View position', async () => {
      const plugin = await createPlugin({
        name: 'Panel-only plugin',
        logo: 'https://example.test/panel-only.png',
        positions: [PluginPosition.Panel],
      });
      const viewsBefore = await getViews(table.id);

      try {
        await submitPlugin(plugin.data.id);
        await publishPlugin(plugin.data.id);
        const error = await getError(() =>
          createViewApi(table.id, {
            type: ViewType.Plugin,
            options: {
              pluginId: plugin.data.id,
              pluginInstallId: 'ignored-by-create',
              pluginLogo: 'ignored-by-create',
            },
          })
        );

        expect(error?.status).toBe(400);
        expect(error?.data).toMatchObject({ domainCode: 'validation.invalid' });
        await expect(getViews(table.id)).resolves.toHaveLength(viewsBefore.length);
      } finally {
        await deletePlugin(plugin.data.id);
      }
    });
  });

  it('/api/table/{tableId}/view (POST) with gallery view', async () => {
    const viewRo: IViewRo = {
      name: 'New gallery view',
      description: 'the new gallery view',
      type: ViewType.Gallery,
    };

    const fieldVo = await createField(table.id, {
      name: 'Attachment',
      type: FieldType.Attachment,
    });
    await createView(table.id, viewRo);

    const result = await getViews(table.id);
    expect(result).toMatchObject([
      ...defaultViews,
      {
        name: 'New gallery view',
        description: 'the new gallery view',
        type: ViewType.Gallery,
        options: {
          coverFieldId: fieldVo.id,
        },
      },
    ]);
  });

  it('should update view simple properties', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const view = await createView(table.id, viewRo);

    await updateViewName(table.id, view.id, { name: 'New view 2' });
    await updateViewDescription(table.id, view.id, { description: 'description2' });
    await updateViewLocked(table.id, view.id, { isLocked: true });
    const viewNew = await getView(table.id, view.id);

    expect(viewNew.name).toEqual('New view 2');
    expect(viewNew.description).toEqual('description2');
    expect(viewNew.isLocked).toBeTruthy();
  });

  it('should create view with field order', async () => {
    // get fields
    const fields = await getFields(table.id);
    const testFieldId = fields?.[0].id;
    const assertOrder = 10;
    const columnMeta = fields.reduce<Record<string, IColumn>>(
      (pre, cur, index) => {
        pre[cur.id] = {} as IColumn;
        pre[cur.id].order = index === 0 ? assertOrder : index;
        return pre;
      },
      {} as Record<string, IColumn>
    );

    const viewResponse = await createView(table.id, {
      name: 'view',
      columnMeta,
      type: ViewType.Grid,
    });

    const { columnMeta: columnMetaResponse } = viewResponse;
    const order = columnMetaResponse?.[testFieldId]?.order;
    expect(order).toEqual(assertOrder);
    expect(fields.length).toEqual(Object.keys(columnMetaResponse).length);
  });

  it('should set all eligible fields visible when creating form view', async () => {
    const formView = await createView(table.id, {
      name: 'Form view',
      type: ViewType.Form,
    });

    const views = await getViews(table.id);
    const createdForm = views.find(({ id }) => id === formView.id)!;
    const formColumnMeta = createdForm.columnMeta as unknown as Record<string, IFormColumn>;

    const eligibleFieldIds = table.fields
      .filter((f) => !f.isComputed && !f.isLookup && f.type !== FieldType.Button)
      .map((f) => f.id);

    eligibleFieldIds.forEach((fieldId) => {
      expect(formColumnMeta[fieldId]?.visible ?? false).toBe(true);
    });
  });

  it('should batch update view when create field', async () => {
    const initialColumnMeta = await viewService.generateViewOrderColumnMeta(table.id);
    const createData: Prisma.ViewCreateManyInput[] = [];
    const num = 100;
    for (let i = 0; i < num; i++) {
      const data: Prisma.ViewCreateManyInput = {
        id: generateViewId(),
        tableId: table.id,
        name: `New view ${i}`,
        type: ViewType.Grid,
        version: 1,
        order: i + 1,
        createdBy: globalThis.testConfig.userId,
        columnMeta: JSON.stringify(initialColumnMeta ?? {}),
      };

      createData.push(data);
    }
    const result = await prismaService.txClient().view.createMany({ data: createData });
    expect(result.count).toEqual(num);

    await createField(table.id, { type: FieldType.SingleLineText });
    const fields = await getFields(table.id);
    const assertFieldIds = fields.map((field) => field.id).sort();
    const randomViewId = sample(createData.map((data) => data.id));
    const view = await getView(table.id, randomViewId!);
    const columnMetaFieldIds = Object.keys(view.columnMeta).sort();
    expect(columnMetaFieldIds).toEqual(assertFieldIds);
  });

  it('should ignore stale column meta for deleted fields when reading views', async () => {
    const staleField = await createField(table.id, {
      name: 'deleted column meta field',
      type: FieldType.SingleLineText,
    });
    const view = await createView(table.id, {
      name: 'view with stale column meta',
      type: ViewType.Grid,
    });

    await deleteField(table.id, staleField.id);
    const activeFields = await getFields(table.id);
    const activeColumnMeta = activeFields.reduce<Record<string, IColumn>>((acc, field, index) => {
      acc[field.id] = { order: index };
      return acc;
    }, {});

    await prismaService.txClient().view.update({
      where: { id: view.id },
      data: {
        columnMeta: JSON.stringify({
          ...activeColumnMeta,
          [staleField.id]: { order: activeFields.length + 1, visible: true },
        }),
      },
    });

    const activeFieldIds = activeFields.map((field) => field.id).sort();
    const viewAfter = await getView(table.id, view.id);
    const viewsAfter = await getViews(table.id);
    const viewFromList = viewsAfter.find(({ id }) => id === view.id);
    const [viewSnapshot] = await viewService.getSnapshotBulk(table.id, [view.id]);

    expect(viewAfter.columnMeta?.[staleField.id]).toBeUndefined();
    expect(Object.keys(viewAfter.columnMeta ?? {}).sort()).toEqual(activeFieldIds);
    expect(viewFromList?.columnMeta?.[staleField.id]).toBeUndefined();
    expect(Object.keys(viewFromList?.columnMeta ?? {}).sort()).toEqual(activeFieldIds);
    expect(viewSnapshot.data.columnMeta?.[staleField.id]).toBeUndefined();
    expect(Object.keys(viewSnapshot.data.columnMeta ?? {}).sort()).toEqual(activeFieldIds);
  });

  it('fields in new view should sort by created time and primary field is always first', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const oldFields: IFieldVo[] = [];
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));

    const newView = await createView(table.id, viewRo);
    const newFields = await getFields(table.id, newView.id);

    expect(newFields.slice(3)).toMatchObject(oldFields);
  });

  describe('/api/table/{tableId}/view/:viewId/filter-link-records (GET)', () => {
    let table: ITableFullVo;
    let linkTable1: ITableFullVo;
    let linkTable2: ITableFullVo;
    let previousForceV2All: string | undefined;

    const linkTable1FieldRo: IFieldRo[] = [
      {
        name: 'single_line_text_field',
        type: FieldType.SingleLineText,
      },
    ];

    const linkTable2FieldRo: IFieldRo[] = [
      {
        name: 'single_line_text_field',
        type: FieldType.SingleLineText,
      },
    ];

    const linkTable1RecordRo: ICreateTableRo['records'] = [
      {
        fields: {
          single_line_text_field: 'link_table1_record1',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table1_record2',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table1_record3',
        },
      },
    ];
    const linkTable2RecordRo: ICreateTableRo['records'] = [
      {
        fields: {
          single_line_text_field: 'link_table2_record1',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table2_record2',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table2_record3',
        },
      },
    ];

    beforeAll(async () => {
      const fullTable = await createTable(baseId, {
        name: 'filter_link_records',
        fields: [
          {
            name: 'link_field1',
            type: FieldType.SingleLineText,
          },
        ],
        records: [],
      });

      linkTable1 = await createTable(baseId, {
        name: 'link_table1',
        fields: [
          ...linkTable1FieldRo,
          {
            type: FieldType.Link,
            options: {
              foreignTableId: fullTable.id,
              relationship: Relationship.OneMany,
            },
          },
        ],
        records: linkTable1RecordRo,
      });

      linkTable2 = await createTable(baseId, {
        name: 'link_table2',
        fields: [
          ...linkTable2FieldRo,
          {
            type: FieldType.Link,
            options: {
              foreignTableId: fullTable.id,
              relationship: Relationship.OneMany,
            },
          },
        ],
        records: linkTable2RecordRo,
      });

      table = (await getTable(baseId, fullTable.id, { includeContent: true })) as ITableFullVo;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, linkTable1.id);
      await permanentDeleteTable(baseId, linkTable2.id);
    });

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('returns nested, deduplicated Link records through v2 without using ViewService', async () => {
      const missingRecordId = generateRecordId();
      const viewRo: IViewRo = {
        name: 'New view',
        description: 'the new view',
        type: ViewType.Grid,
        filter: {
          filterSet: [
            {
              fieldId: table.fields![1].id,
              value: linkTable1.records[0].id,
              operator: 'is',
            },
            {
              filterSet: [
                {
                  fieldId: table.fields![1].id,
                  value: [
                    linkTable1.records[0].id,
                    linkTable1.records[1].id,
                    linkTable1.records[2].id,
                    missingRecordId,
                  ],
                  operator: 'isAnyOf',
                },
              ],
              conjunction: 'and',
            },
            {
              fieldId: table.fields![2].id,
              value: linkTable2.records[0].id,
              operator: 'is',
            },
            {
              filterSet: [
                {
                  fieldId: table.fields![2].id,
                  value: [linkTable2.records[2].id],
                  operator: 'isAnyOf',
                },
              ],
              conjunction: 'and',
            },
          ],
          conjunction: 'and',
        },
      };

      const viewResponse = await createViewApi(table.id, viewRo);
      expect(viewResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      const legacyReadSpy = vi
        .spyOn(viewService, 'getViewById')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));

      const response = await getViewFilterLinkRecords(table.id, viewResponse.data.id);
      const records = response.data;

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getViewFilterLinkRecords');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(legacyReadSpy).not.toHaveBeenCalled();
      expect(records).toMatchObject([
        {
          tableId: linkTable1.id,
          records: [
            { id: linkTable1.records[0].id, title: 'link_table1_record1' },
            { id: linkTable1.records[1].id, title: 'link_table1_record2' },
            { id: linkTable1.records[2].id, title: 'link_table1_record3' },
          ],
        },
        {
          tableId: linkTable2.id,
          records: [
            { id: linkTable2.records[0].id, title: 'link_table2_record1' },
            {
              id: linkTable2.records[2].id,
              title: 'link_table2_record3',
            },
          ],
        },
      ]);
    });

    it('returns an empty list when filters do not reference a Link Field', async () => {
      const viewResponse = await createViewApi(table.id, {
        name: 'No Link references',
        type: ViewType.Grid,
        filter: {
          filterSet: [
            {
              fieldId: table.fields![0].id,
              value: generateRecordId(),
              operator: 'is',
            },
          ],
          conjunction: 'and',
        },
      });

      const response = await getViewFilterLinkRecords(table.id, viewResponse.data.id);

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.data).toEqual([]);
    });

    it('does not 500 on v1 when the table has a lookup-of-link field (T6502)', async () => {
      // Sanitized structure-equivalent of prod: host table has a real Link field
      // plus a lookup-of-link field with NULL options; view filter is non-link text.
      const previousForceV2All = process.env.FORCE_V2_ALL;
      const previousCanary = process.env.ENABLE_CANARY_FEATURE;
      const previousBase = await prismaService.base.findUniqueOrThrow({
        where: { id: baseId },
        select: { v2Enabled: true },
      });

      process.env.FORCE_V2_ALL = 'false';
      process.env.ENABLE_CANARY_FEATURE = 'false';
      await prismaService.base.update({
        where: { id: baseId },
        data: { v2Enabled: false },
      });

      let foreignTable: ITableFullVo | undefined;
      let hostTable: ITableFullVo | undefined;
      let landlordTable: ITableFullVo | undefined;

      try {
        foreignTable = await createTable(baseId, {
          name: 'filter_link_lookup_foreign',
          fields: [{ name: 'Title', type: FieldType.SingleLineText }],
          records: [{ fields: { Title: 'flat-a' } }],
        });

        landlordTable = await createTable(baseId, {
          name: 'filter_link_lookup_landlord',
          fields: [{ name: 'Name', type: FieldType.SingleLineText }],
          records: [{ fields: { Name: 'landlord-a' } }],
        });

        const foreignToLandlord = await createField(foreignTable.id, {
          name: 'Landlord',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: landlordTable.id,
          },
        });

        hostTable = await createTable(baseId, {
          name: 'filter_link_lookup_host',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText },
            {
              name: 'Flat',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyOne,
                foreignTableId: foreignTable.id,
              },
            },
          ],
          records: [{ fields: { Name: 'contract-a' } }],
        });

        const hostLinkField = hostTable.fields.find((field) => field.name === 'Flat');
        const nameField = hostTable.fields.find((field) => field.name === 'Name');
        if (!hostLinkField || !nameField) {
          throw new Error('host table fixture is incomplete');
        }

        const lookupOfLink = await createField(hostTable.id, {
          name: 'Landlord Lookup',
          type: FieldType.Link,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreignTable.id,
            linkFieldId: hostLinkField.id,
            lookupFieldId: foreignToLandlord.id,
          },
        });

        // Match prod shape: lookup-of-link rows can legally have NULL options.
        await prismaService.field.update({
          where: { id: lookupOfLink.id },
          data: { options: null },
        });

        const viewResponse = await createViewApi(hostTable.id, {
          name: 'Non-link filter view',
          type: ViewType.Grid,
          filter: {
            filterSet: [
              {
                fieldId: nameField.id,
                value: 'contract',
                operator: 'contains',
              },
            ],
            conjunction: 'and',
          },
        });

        const response = await getViewFilterLinkRecords(hostTable.id, viewResponse.data.id);

        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('false');
        expect(response.status).toBe(200);
        expect(response.data).toEqual([]);
      } finally {
        if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
        else process.env.FORCE_V2_ALL = previousForceV2All;
        if (previousCanary == null) delete process.env.ENABLE_CANARY_FEATURE;
        else process.env.ENABLE_CANARY_FEATURE = previousCanary;
        await prismaService.base.update({
          where: { id: baseId },
          data: { v2Enabled: previousBase.v2Enabled },
        });
        if (hostTable) await permanentDeleteTable(baseId, hostTable.id);
        if (foreignTable) await permanentDeleteTable(baseId, foreignTable.id);
        if (landlordTable) await permanentDeleteTable(baseId, landlordTable.id);
      }
    });

    it('returns view.not_found when the View belongs to another Table', async () => {
      const anotherTable = await createTable(baseId, { name: 'another_filter_link_table' });

      try {
        const [anotherView] = await getViews(anotherTable.id);
        const error = await getError(() => getViewFilterLinkRecords(table.id, anotherView.id));

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('Update View column metadata v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;
    const windowIdHeader = 'X-Window-Id';

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      axios.defaults.headers.common[windowIdHeader] = 'update-view-column-meta-v2-window';
    });

    afterEach(() => {
      delete axios.defaults.headers.common[windowIdHeader];
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('updates supported metadata and emits only v2 domain-event projections', async () => {
      const view = (await getViews(table.id))[0]!;
      const field = table.fields[1];
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyColumnMetaSpy = vi
        .spyOn(viewOpenApiService, 'updateViewColumnMeta')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await updateViewColumnMeta(table.id, view.id, [
        {
          fieldId: field.id,
          columnMeta: {
            order: 9,
            width: 320,
            hidden: true,
            statisticFunc: StatisticsFunc.Sum,
          },
        },
      ]);

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewColumnMeta');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, view.id)).columnMeta[field.id]).toMatchObject({
        order: 9,
        width: 320,
        hidden: true,
        statisticFunc: StatisticsFunc.Sum,
      });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { version: true },
        })
      ).resolves.toEqual({ version: rowBefore.version + 1 });
      expect(legacyColumnMetaSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('adds the default order when patching metadata for a missing column entry', async () => {
      const view = (await getViews(table.id))[0]!;
      const primaryField = table.fields[0];
      const field = table.fields.at(-1)!;
      await prismaService.view.update({
        where: { id: view.id },
        data: {
          columnMeta: JSON.stringify({
            [primaryField.id]: { order: 0 },
          }),
        },
      });

      await updateViewColumnMeta(table.id, view.id, [
        {
          fieldId: field.id,
          columnMeta: { width: 241 },
        },
      ]);

      expect((await getView(table.id, view.id)).columnMeta[field.id]).toEqual({
        order: table.fields.length - 1,
        width: 241,
      });
    });

    it('updates the aggregate-owned frozen-field boundary when the frozen field moves', async () => {
      const [primaryField, frozenField] = table.fields;
      const viewResponse = await createViewApi(table.id, {
        name: 'Frozen columns',
        type: ViewType.Grid,
        options: { frozenFieldId: frozenField.id },
      });

      const response = await updateViewColumnMeta(table.id, viewResponse.data.id, [
        {
          fieldId: frozenField.id,
          columnMeta: { order: 9 },
        },
      ]);

      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewColumnMeta');
      expect((await getView(table.id, viewResponse.data.id)).options).toMatchObject({
        frozenFieldId: primaryField.id,
      });
    });

    it('rejects hiding the primary field and a View from another Table without persistence', async () => {
      const view = (await getViews(table.id))[0]!;
      const before = await getView(table.id, view.id);
      const hidePrimaryError = await getError(() =>
        updateViewColumnMeta(table.id, view.id, [
          {
            fieldId: table.fields[0].id,
            columnMeta: { hidden: true },
          },
        ])
      );
      expect(hidePrimaryError?.status).toBe(400);
      expect(hidePrimaryError?.data).toMatchObject({
        domainCode: 'view.primary_field_cannot_be_hidden',
      });
      expect((await getView(table.id, view.id)).columnMeta).toEqual(before.columnMeta);

      const anotherTable = await createTable(baseId, { name: 'column_meta_other_table' });
      try {
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const error = await getError(() =>
          updateViewColumnMeta(table.id, anotherView.id, [
            {
              fieldId: table.fields[1].id,
              columnMeta: { width: 200 },
            },
          ])
        );
        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('treats empty and identical patches as no-op writes', async () => {
      const view = (await getViews(table.id))[0]!;
      const field = table.fields[1];
      const existing = view.columnMeta[field.id]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });

      const emptyResponse = await updateViewColumnMeta(table.id, view.id, []);
      const identicalResponse = await updateViewColumnMeta(table.id, view.id, [
        {
          fieldId: field.id,
          columnMeta: { order: existing.order },
        },
      ]);

      expect(emptyResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewColumnMeta');
      expect(identicalResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewColumnMeta');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { version: true },
        })
      ).resolves.toEqual(rowBefore);
    });
  });

  describe('Update View filter v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;
    const windowIdHeader = 'X-Window-Id';

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      axios.defaults.headers.common[windowIdHeader] = 'update-view-filter-v2-window';
    });

    afterEach(() => {
      delete axios.defaults.headers.common[windowIdHeader];
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('updates a nested source filter through the Table aggregate and v2 projections', async () => {
      const view = (await getViews(table.id))[0]!;
      const [textField, numberField] = table.fields;
      const filter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: textField.id,
            operator: '=' as const,
            value: 'alpha',
            isSymbol: true as const,
          },
          {
            conjunction: 'or' as const,
            filterSet: [
              { fieldId: numberField.id, operator: 'isGreater' as const, value: 3 },
              {
                fieldId: textField.id,
                operator: 'is' as const,
                value: {
                  type: 'field' as const,
                  fieldId: textField.id,
                  tableId: table.id,
                },
              },
            ],
          },
        ],
      };
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyPropertySpy = vi
        .spyOn(viewOpenApiService, 'setViewProperty')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await updateViewFilter(table.id, view.id, { filter });

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewFilter');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, view.id)).filter).toEqual(filter);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { version: true },
        })
      ).resolves.toEqual({ version: rowBefore.version + 1 });
      expect(legacyPropertySpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('preserves empty and incomplete filters, skips identical writes, and clears null', async () => {
      const view = (await getViews(table.id))[0]!;
      const emptyFilter = { conjunction: 'and' as const, filterSet: [] };
      await updateViewFilter(table.id, view.id, { filter: emptyFilter });
      const afterEmpty = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const identical = await updateViewFilter(table.id, view.id, { filter: emptyFilter });
      expect(identical.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewFilter');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { version: true },
        })
      ).resolves.toEqual(afterEmpty);

      const incompleteFilter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: table.fields[0].id,
            operator: 'isNot' as const,
            value: null,
          },
        ],
      };
      await updateViewFilter(table.id, view.id, { filter: incompleteFilter });
      expect((await getView(table.id, view.id)).filter).toEqual(incompleteFilter);
      await updateViewFilter(table.id, view.id, { filter: null });
      expect((await getView(table.id, view.id)).filter).toBeUndefined();
    });

    it('T6568 preserves incomplete conditions while selecting a conditional lookup field', async () => {
      const view = (await getViews(table.id))[0]!;
      const source = await createTable(baseId, {
        name: 'view_filter_source',
        fields: [
          { name: 'Match key', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Product', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [],
      });

      try {
        const hostMatchField = await createField(table.id, {
          name: 'Order key',
          type: FieldType.SingleLineText,
        });
        const accountTagsField = await createField(table.id, {
          name: 'Account tags',
          type: FieldType.MultipleSelect,
          options: {
            choices: [{ name: 'Partner', color: Colors.Gray }],
          },
        });
        const sourceMatchField = source.fields.find((field) => field.name === 'Match key')!;
        const sourceProductField = source.fields.find((field) => field.name === 'Product')!;
        const productNameField = await createField(table.id, {
          name: 'Product name',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: source.id,
            lookupFieldId: sourceProductField.id,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: sourceMatchField.id,
                  operator: 'is',
                  value: { type: 'field', fieldId: hostMatchField.id, tableId: table.id },
                },
              ],
            },
          },
        } as IFieldRo);
        const filter = {
          conjunction: 'and' as const,
          filterSet: [
            {
              fieldId: table.fields[0].id,
              operator: 'is' as const,
              value: 'kept',
            },
            {
              fieldId: accountTagsField.id,
              operator: 'hasAnyOf' as const,
              value: null,
            },
            {
              fieldId: productNameField.id,
              operator: 'is' as const,
              value: null,
            },
          ],
        };

        const response = await updateViewFilter(table.id, view.id, { filter });

        expect(response.status).toBe(200);
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewFilter');
        expect((await getView(table.id, view.id)).filter).toEqual(filter);
        const persistedView = await prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { filter: true },
        });
        expect(JSON.parse(persistedView.filter!)).toEqual(filter);
      } finally {
        await permanentDeleteTable(baseId, source.id);
      }
    });

    it('rejects missing fields, Button fields, and incompatible operators without persistence', async () => {
      const view = (await getViews(table.id))[0]!;
      const buttonField = await createField(table.id, {
        name: 'Filter action',
        type: FieldType.Button,
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { filter: true, version: true },
      });
      const cases = [
        {
          filter: {
            conjunction: 'and' as const,
            filterSet: [
              {
                fieldId: `fld${'z'.repeat(16)}`,
                operator: 'is' as const,
                value: 'missing',
              },
            ],
          },
          domainCode: 'field.not_found',
          status: 404,
        },
        {
          filter: {
            conjunction: 'and' as const,
            filterSet: [{ fieldId: buttonField.id, operator: 'isEmpty' as const, value: null }],
          },
          domainCode: 'view.filter_unsupported_field_type',
          status: 400,
        },
        {
          filter: {
            conjunction: 'and' as const,
            filterSet: [
              {
                fieldId: table.fields[1].id,
                operator: 'contains' as const,
                value: 'three',
              },
            ],
          },
          status: 400,
        },
      ];
      for (const testCase of cases) {
        const error = await getError(() =>
          updateViewFilter(table.id, view.id, { filter: testCase.filter })
        );
        expect(error?.status).toBe(testCase.status);
        if (testCase.domainCode) {
          expect(error?.data).toMatchObject({ domainCode: testCase.domainCode });
        }
      }
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { filter: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });

    it('rejects a View owned by another Table without crossing the aggregate boundary', async () => {
      const anotherTable = await createTable(baseId, { name: 'filter_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: sourceView.id },
          select: { filter: true, version: true },
        });
        const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

        const error = await getError(() =>
          updateViewFilter(table.id, anotherView.id, { filter: null })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: sourceView.id },
            select: { filter: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyPropertySpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('Update View sort v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;
    const windowIdHeader = 'X-Window-Id';

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      axios.defaults.headers.common[windowIdHeader] = 'update-view-sort-v2-window';
    });

    afterEach(() => {
      delete axios.defaults.headers.common[windowIdHeader];
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('updates multiple sort items through the Table aggregate and v2 projections', async () => {
      const view = (await getViews(table.id))[0]!;
      const sort = {
        sortObjs: [
          { fieldId: table.fields[0].id, order: SortFunc.Asc },
          { fieldId: table.fields[1].id, order: SortFunc.Desc },
        ],
        manualSort: false,
      };
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyPropertySpy = vi
        .spyOn(viewOpenApiService, 'setViewProperty')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await updateViewSort(table.id, view.id, { sort });

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewSort');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, view.id)).sort).toEqual(sort);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { sort: true, version: true },
        })
      ).resolves.toEqual({
        sort: JSON.stringify(sort),
        version: rowBefore.version + 1,
      });
      expect(legacyPropertySpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('preserves empty and manual sorts, skips identical writes, and clears null', async () => {
      const view = (await getViews(table.id))[0]!;
      await updateViewSort(table.id, view.id, { sort: { sortObjs: [] } });
      expect((await getView(table.id, view.id)).sort).toEqual({ sortObjs: [] });

      await updateViewSort(table.id, view.id, {
        sort: { sortObjs: [], manualSort: true },
      });
      const afterManual = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const identical = await updateViewSort(table.id, view.id, {
        sort: { sortObjs: [], manualSort: true },
      });
      expect(identical.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewSort');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { version: true },
        })
      ).resolves.toEqual(afterManual);
      expect((await getView(table.id, view.id)).sort).toEqual({
        sortObjs: [],
        manualSort: true,
      });

      await updateViewSort(table.id, view.id, { sort: null });
      expect((await getView(table.id, view.id)).sort).toBeUndefined();
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { sort: true },
        })
      ).resolves.toEqual({ sort: null });
    });

    it('rejects missing fields and Button fields without persistence or v1 fallback', async () => {
      const view = (await getViews(table.id))[0]!;
      const buttonField = await createField(table.id, {
        name: 'Sort action',
        type: FieldType.Button,
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { sort: true, version: true },
      });
      const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');
      const cases = [
        {
          fieldId: `fld${'z'.repeat(16)}`,
          domainCode: 'field.not_found',
          status: 404,
        },
        {
          fieldId: buttonField.id,
          domainCode: 'view.sort_unsupported_field_type',
          status: 400,
        },
      ];

      for (const testCase of cases) {
        const error = await getError(() =>
          updateViewSort(table.id, view.id, {
            sort: {
              sortObjs: [{ fieldId: testCase.fieldId, order: SortFunc.Asc }],
            },
          })
        );
        expect(error?.status).toBe(testCase.status);
        expect(error?.data).toMatchObject({ domainCode: testCase.domainCode });
      }
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { sort: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(legacyPropertySpy).not.toHaveBeenCalled();
    });

    it('rejects a View owned by another Table without crossing the aggregate boundary', async () => {
      const anotherTable = await createTable(baseId, { name: 'sort_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: sourceView.id },
          select: { sort: true, version: true },
        });
        const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

        const error = await getError(() =>
          updateViewSort(table.id, anotherView.id, { sort: null })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: sourceView.id },
            select: { sort: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyPropertySpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('rejects invalid sort directions at the HTTP boundary', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { sort: true, version: true },
      });

      const error = await getError(() =>
        axios.put(`/table/${table.id}/view/${view.id}/sort`, {
          sort: {
            sortObjs: [{ fieldId: table.fields[0].id, order: 'up' }],
          },
        })
      );

      expect(error?.status).toBe(400);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { sort: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });
  });

  describe('View manual sort v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;
    const windowIdHeader = 'X-Window-Id';

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      axios.defaults.headers.common[windowIdHeader] = 'manual-sort-view-v2-window';
    });

    afterEach(() => {
      delete axios.defaults.headers.common[windowIdHeader];
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('materializes multi-row field sort with stable ties through native v2', async () => {
      const view = (await getViews(table.id))[0]!;
      const primaryFieldId = table.fields[0].id;
      const { records } = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [primaryFieldId]: 'Beta' } },
          { fields: { [primaryFieldId]: 'Alpha' } },
          { fields: { [primaryFieldId]: 'Beta' } },
        ],
      });
      const legacyManualSortSpy = vi
        .spyOn(viewOpenApiService, 'manualSort')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyViewSortSpy = vi.spyOn(viewService, 'updateViewSort');
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await manualSortView(table.id, view.id, {
        sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
      });

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('manualSortView');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, view.id)).sort).toEqual({
        sortObjs: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
        manualSort: true,
      });
      const ordered = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: view.id,
      });
      expect(ordered.data.records.slice(0, 3).map((record) => record.id)).toEqual([
        records[0]!.id,
        records[2]!.id,
        records[1]!.id,
      ]);
      expect(legacyManualSortSpy).not.toHaveBeenCalled();
      expect(legacyViewSortSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('preserves empty sort and skips an identical View metadata write', async () => {
      const view = (await getViews(table.id))[0]!;
      const legacyManualSortSpy = vi.spyOn(viewOpenApiService, 'manualSort');

      const first = await manualSortView(table.id, view.id, { sortObjs: [] });
      expect(first.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('manualSortView');
      expect((await getView(table.id, view.id)).sort).toEqual({
        sortObjs: [],
        manualSort: true,
      });
      const afterFirst = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });

      const identical = await manualSortView(table.id, view.id, { sortObjs: [] });

      expect(identical.headers[X_TEABLE_V2_HEADER]).toBe('true');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { version: true },
        })
      ).resolves.toEqual(afterFirst);
      expect(legacyManualSortSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid fields, types, directions, and aggregate ownership without v1 fallback', async () => {
      const view = (await getViews(table.id))[0]!;
      const buttonField = await createField(table.id, {
        name: 'Manual sort action',
        type: FieldType.Button,
      });
      const galleryView = await createView(table.id, {
        name: 'Manual sort gallery',
        type: ViewType.Gallery,
      });
      const anotherTable = await createTable(baseId, { name: 'manual_sort_other_table' });
      const legacyManualSortSpy = vi.spyOn(viewOpenApiService, 'manualSort');
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { sort: true, version: true },
      });

      try {
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const cases = [
          {
            run: () =>
              manualSortView(table.id, view.id, {
                sortObjs: [{ fieldId: `fld${'z'.repeat(16)}`, order: SortFunc.Asc }],
              }),
            status: 404,
            domainCode: 'field.not_found',
          },
          {
            run: () =>
              manualSortView(table.id, view.id, {
                sortObjs: [{ fieldId: buttonField.id, order: SortFunc.Asc }],
              }),
            status: 400,
            domainCode: 'view.sort_unsupported_field_type',
          },
          {
            run: () => manualSortView(table.id, galleryView.id, { sortObjs: [] }),
            status: 400,
            domainCode: 'view.manual_sort_unsupported_type',
          },
          {
            run: () => manualSortView(table.id, anotherView.id, { sortObjs: [] }),
            status: 404,
            domainCode: 'view.not_found',
          },
        ];

        for (const testCase of cases) {
          const error = await getError(testCase.run);
          expect(error?.status).toBe(testCase.status);
          expect(error?.data).toMatchObject({ domainCode: testCase.domainCode });
        }

        const malformed = await getError(() =>
          axios.put(`/table/${table.id}/view/${view.id}/manual-sort`, {
            sortObjs: [{ fieldId: table.fields[0].id, order: 'up' }],
          })
        );
        expect(malformed?.status).toBe(400);
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: view.id },
            select: { sort: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyManualSortSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('Update View group v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;
    const windowIdHeader = 'X-Window-Id';

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      axios.defaults.headers.common[windowIdHeader] = 'update-view-group-v2-window';
    });

    afterEach(() => {
      delete axios.defaults.headers.common[windowIdHeader];
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('updates multiple group items through the Table aggregate and v2 projections', async () => {
      const view = (await getViews(table.id))[0]!;
      const group = [
        { fieldId: table.fields[0].id, order: SortFunc.Asc },
        { fieldId: table.fields[1].id, order: SortFunc.Desc },
      ];
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyPropertySpy = vi
        .spyOn(viewOpenApiService, 'setViewProperty')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await updateViewGroup(table.id, view.id, { group });

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewGroup');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, view.id)).group).toEqual(group);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { group: true, version: true },
        })
      ).resolves.toEqual({
        group: JSON.stringify(group),
        version: rowBefore.version + 1,
      });
      expect(legacyPropertySpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('preserves empty groups, skips identical writes, and clears null', async () => {
      const view = (await getViews(table.id))[0]!;
      await updateViewGroup(table.id, view.id, { group: [] });
      // Legacy View responses omit empty group arrays, while v2 keeps the persisted
      // distinction so an identical request remains a true no-op.
      expect((await getView(table.id, view.id)).group).toBeUndefined();
      const afterEmpty = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { group: true, version: true },
      });
      expect(afterEmpty.group).toBe('[]');

      const identical = await updateViewGroup(table.id, view.id, { group: [] });
      expect(identical.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewGroup');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { group: true, version: true },
        })
      ).resolves.toEqual(afterEmpty);

      await updateViewGroup(table.id, view.id, { group: null });
      expect((await getView(table.id, view.id)).group).toBeUndefined();
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { group: true },
        })
      ).resolves.toEqual({ group: null });
    });

    it('rejects missing fields and Button fields without persistence or v1 fallback', async () => {
      const view = (await getViews(table.id))[0]!;
      const buttonField = await createField(table.id, {
        name: 'Group action',
        type: FieldType.Button,
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { group: true, version: true },
      });
      const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');
      const cases = [
        {
          fieldId: `fld${'z'.repeat(16)}`,
          domainCode: 'field.not_found',
          status: 404,
        },
        {
          fieldId: buttonField.id,
          domainCode: 'view.group_unsupported_field_type',
          status: 400,
        },
      ];

      for (const testCase of cases) {
        const error = await getError(() =>
          updateViewGroup(table.id, view.id, {
            group: [{ fieldId: testCase.fieldId, order: SortFunc.Asc }],
          })
        );
        expect(error?.status).toBe(testCase.status);
        expect(error?.data).toMatchObject({ domainCode: testCase.domainCode });
      }
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { group: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(legacyPropertySpy).not.toHaveBeenCalled();
    });

    it('rejects a View owned by another Table without crossing the aggregate boundary', async () => {
      const anotherTable = await createTable(baseId, { name: 'group_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: sourceView.id },
          select: { group: true, version: true },
        });
        const legacyPropertySpy = vi.spyOn(viewOpenApiService, 'setViewProperty');

        const error = await getError(() =>
          updateViewGroup(table.id, anotherView.id, { group: null })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: sourceView.id },
            select: { group: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyPropertySpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('rejects invalid group directions at the HTTP boundary', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { group: true, version: true },
      });

      const error = await getError(() =>
        axios.put(`/table/${table.id}/view/${view.id}/group`, {
          group: [{ fieldId: table.fields[0].id, order: 'up' }],
        })
      );

      expect(error?.status).toBe(400);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { group: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });
  });

  describe('Update View options v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;
    const windowIdHeader = 'X-Window-Id';

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      axios.defaults.headers.common[windowIdHeader] = 'update-view-options-v2-window';
    });

    afterEach(() => {
      delete axios.defaults.headers.common[windowIdHeader];
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it.each([
      [ViewType.Grid, { rowHeight: RowHeightLevel.Tall, fieldNameDisplayLines: 2 }],
      [ViewType.Kanban, { coverFieldId: null, isEmptyStackHidden: true }],
      [ViewType.Gallery, { coverFieldId: null, isCoverFit: true }],
      [
        ViewType.Calendar,
        {
          startDateFieldId: null,
          colorConfig: { type: ColorConfigType.Custom, color: Colors.Blue },
        },
      ],
      [ViewType.Form, { submitLabel: 'Send' }],
    ] as const)('updates %s options through the Table aggregate', async (type, options) => {
      const created = await createViewApi(table.id, {
        name: `Options ${type}`,
        type,
      });
      const viewId = created.data.id;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: viewId },
        select: { version: true },
      });
      const legacyOptionsSpy = vi
        .spyOn(viewOpenApiService, 'patchViewOptions')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await updateViewOptions(table.id, viewId, { options });

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewOptions');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, viewId)).options).toMatchObject(options);
      const persisted = await prismaService.view.findUniqueOrThrow({
        where: { id: viewId },
        select: { options: true, version: true },
      });
      expect(JSON.parse(persisted.options!)).toMatchObject(options);
      expect(persisted.version).toBe(rowBefore.version + 1);
      expect(legacyOptionsSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('updates complete Plugin options and enforces the subtype contract', async () => {
      const created = await createViewApi(table.id, {
        name: 'Options plugin',
        type: ViewType.Plugin,
        options: {
          pluginId: 'plgsheetform',
          pluginInstallId: 'ignored-by-create',
          pluginLogo: 'ignored-by-create',
        },
      });
      const current = (await getView(table.id, created.data.id)).options as IPluginViewOptions;
      const next = { ...current, pluginLogo: 'https://example.test/next-logo.png' };
      const legacyOptionsSpy = vi.spyOn(viewOpenApiService, 'patchViewOptions');

      const response = await updateViewOptions(table.id, created.data.id, { options: next });

      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewOptions');
      expect((await getView(table.id, created.data.id)).options).toMatchObject({
        pluginId: next.pluginId,
        pluginInstallId: next.pluginInstallId,
      });
      expect(legacyOptionsSpy).not.toHaveBeenCalled();

      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: created.data.id },
        select: { options: true, version: true },
      });
      expect(JSON.parse(rowBefore.options!)).toEqual(next);
      const error = await getError(() =>
        axios.patch(`/table/${table.id}/view/${created.data.id}/options`, {
          options: { pluginLogo: 'incomplete.png' },
        })
      );
      expect(error?.status).toBe(400);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: created.data.id },
          select: { options: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });

    it('shallow-merges, preserves null, and skips an identical write', async () => {
      const created = await createViewApi(table.id, {
        name: 'Options merge',
        type: ViewType.Gallery,
        options: { coverFieldId: table.fields[0].id, isCoverFit: true },
      });
      await updateViewOptions(table.id, created.data.id, {
        options: { coverFieldId: null },
      });
      expect((await getView(table.id, created.data.id)).options).toEqual({
        coverFieldId: null,
        isCoverFit: true,
      });
      const afterClear = await prismaService.view.findUniqueOrThrow({
        where: { id: created.data.id },
        select: { options: true, version: true },
      });

      const identical = await updateViewOptions(table.id, created.data.id, {
        options: { coverFieldId: null },
      });
      expect(identical.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewOptions');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: created.data.id },
          select: { options: true, version: true },
        })
      ).resolves.toEqual(afterClear);
    });

    it('rejects subtype mismatches without persistence or v1 fallback', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { options: true, version: true },
      });
      const legacyOptionsSpy = vi.spyOn(viewOpenApiService, 'patchViewOptions');

      const error = await getError(() =>
        updateViewOptions(table.id, view.id, { options: { submitLabel: 'Wrong subtype' } })
      );

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({ domainCode: 'view.options_invalid' });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { options: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(legacyOptionsSpy).not.toHaveBeenCalled();
    });

    it('rejects a View owned by another Table without crossing the aggregate boundary', async () => {
      const anotherTable = await createTable(baseId, { name: 'options_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: sourceView.id },
          select: { options: true, version: true },
        });
        const legacyOptionsSpy = vi.spyOn(viewOpenApiService, 'patchViewOptions');

        const error = await getError(() =>
          updateViewOptions(table.id, anotherView.id, { options: {} })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: sourceView.id },
            select: { options: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyOptionsSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('Update View share metadata v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('replaces the complete share metadata through the Table aggregate', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyShareMetaSpy = vi
        .spyOn(viewOpenApiService, 'updateShareMeta')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
      const shareMeta = {
        allowCopy: true,
        includeHiddenField: true,
        password: 'secret-123',
        includeRecords: true,
        submit: { requireLogin: true },
        allowEdit: true,
      };

      const response = await updateViewShareMeta(table.id, view.id, shareMeta);

      expect(response.status).toBe(200);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewShareMeta');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect((await getView(table.id, view.id)).shareMeta).toEqual(shareMeta);
      const persisted = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { shareMeta: true, version: true },
      });
      expect(JSON.parse(persisted.shareMeta!)).toEqual(shareMeta);
      expect(persisted.version).toBe(rowBefore.version + 1);
      expect(legacyShareMetaSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('persists empty metadata and treats an identical replacement as a no-op', async () => {
      const view = (await getViews(table.id))[0]!;
      const first = await updateViewShareMeta(table.id, view.id, {});
      expect(first.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewShareMeta');
      const rowAfterFirst = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { shareMeta: true, version: true },
      });
      expect(JSON.parse(rowAfterFirst.shareMeta!)).toEqual({});

      const identical = await updateViewShareMeta(table.id, view.id, {});
      expect(identical.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewShareMeta');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { shareMeta: true, version: true },
        })
      ).resolves.toEqual(rowAfterFirst);
    });

    it('rejects a View owned by another Table without crossing the aggregate boundary', async () => {
      const anotherTable = await createTable(baseId, { name: 'share_meta_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: sourceView.id },
          select: { shareMeta: true, version: true },
        });
        const legacyShareMetaSpy = vi.spyOn(viewOpenApiService, 'updateShareMeta');

        const error = await getError(() =>
          updateViewShareMeta(table.id, anotherView.id, { allowCopy: true })
        );

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: sourceView.id },
            select: { shareMeta: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyShareMetaSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it.each([
      [{ password: 'ab' }, 'short password'],
      [{ allowCopy: 'yes' }, 'non-boolean flag'],
      [{ submit: { requireLogin: 'yes' } }, 'invalid nested submit flag'],
    ])('rejects invalid metadata at the HTTP boundary: %s (%s)', async (shareMeta) => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { shareMeta: true, version: true },
      });

      const error = await getError(() =>
        axios.put(`/table/${table.id}/view/${view.id}/share-meta`, shareMeta)
      );

      expect(error?.status).toBe(400);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { shareMeta: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
    });
  });

  describe('Refresh View share ID v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('rotates the share ID through the Table aggregate and revokes the old ID', async () => {
      const view = (await getViews(table.id))[0]!;
      const enabled = await enableShareView({ tableId: table.id, viewId: view.id });
      const oldShareId = enabled.data.shareId;
      const oldShortLink = await createShortLink({
        type: ShortLinkType.ViewShare,
        resourceId: oldShareId,
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyRefreshSpy = vi
        .spyOn(viewOpenApiService, 'refreshShareId')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await axios.post<IRefreshShareViewVo>(
        `/table/${table.id}/view/${view.id}/refresh-share-id`
      );

      expect(response.status).toBe(201);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('refreshViewShareId');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data.shareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
      expect(response.data.shareId).not.toBe(oldShareId);
      await expect(getShareView(oldShareId)).rejects.toThrow();
      expect((await getError(() => getShortLink(oldShortLink.data.code)))?.status).toBe(404);
      await expect(getShareView(response.data.shareId)).resolves.toMatchObject({
        data: { viewId: view.id, shareId: response.data.shareId },
      });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { shareId: true, version: true },
        })
      ).resolves.toEqual({
        shareId: response.data.shareId,
        version: rowBefore.version + 1,
      });
      expect(legacyRefreshSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('rejects refreshing a View whose sharing is disabled', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { enableShare: true, shareId: true, version: true },
      });
      const legacyRefreshSpy = vi.spyOn(viewOpenApiService, 'refreshShareId');

      const error = await getError(() => refreshViewShareId(table.id, view.id));

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({ domainCode: 'validation.invalid' });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { enableShare: true, shareId: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(legacyRefreshSpy).not.toHaveBeenCalled();
    });

    it('rejects a View owned by another Table without crossing the aggregate boundary', async () => {
      const anotherTable = await createTable(baseId, { name: 'refresh_share_other_table' });
      try {
        const sourceView = (await getViews(table.id))[0]!;
        const anotherView = (await getViews(anotherTable.id))[0]!;
        await enableShareView({ tableId: anotherTable.id, viewId: anotherView.id });
        const rowBefore = await prismaService.view.findUniqueOrThrow({
          where: { id: sourceView.id },
          select: { shareId: true, version: true },
        });
        const legacyRefreshSpy = vi.spyOn(viewOpenApiService, 'refreshShareId');

        const error = await getError(() => refreshViewShareId(table.id, anotherView.id));

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        await expect(
          prismaService.view.findUniqueOrThrow({
            where: { id: sourceView.id },
            select: { shareId: true, version: true },
          })
        ).resolves.toEqual(rowBefore);
        expect(legacyRefreshSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('Enable and disable View share v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it.each([
      [ViewType.Grid, { includeRecords: true }],
      [ViewType.Kanban, { includeRecords: true }],
      [ViewType.Gallery, { includeRecords: true }],
      [ViewType.Calendar, { includeRecords: true }],
      [ViewType.Form, {}],
      [ViewType.Plugin, { includeRecords: true }],
    ])('enables %s sharing with its aggregate-owned default metadata', async (type, shareMeta) => {
      const created = await createViewApi(table.id, {
        name: `Enable ${type}`,
        type,
        ...(type === ViewType.Plugin
          ? {
              options: {
                pluginId: 'plgsheetform',
                pluginInstallId: 'ignored-by-create',
                pluginLogo: 'ignored-by-create',
              },
            }
          : {}),
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: created.data.id },
        select: { version: true },
      });
      const legacyEnableSpy = vi
        .spyOn(viewOpenApiService, 'enableShare')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await enableShareView({ tableId: table.id, viewId: created.data.id });

      expect(response.status).toBe(201);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('enableViewShare');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data.shareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: created.data.id },
          select: { enableShare: true, shareId: true, shareMeta: true, version: true },
        })
      ).resolves.toEqual({
        enableShare: true,
        shareId: response.data.shareId,
        shareMeta: JSON.stringify(shareMeta),
        version: rowBefore.version + 1,
      });
      await expect(getShareView(response.data.shareId)).resolves.toMatchObject({
        data: { viewId: created.data.id, shareId: response.data.shareId },
      });
      expect(legacyEnableSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('preserves existing share metadata and rejects a repeated enable without writing', async () => {
      const created = await createViewApi(table.id, {
        name: 'Enable existing metadata',
        type: ViewType.Grid,
        shareMeta: { allowCopy: false, includeHiddenField: true },
      });
      const legacyEnableSpy = vi.spyOn(viewOpenApiService, 'enableShare');

      await enableShareView({ tableId: table.id, viewId: created.data.id });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: created.data.id },
        select: { enableShare: true, shareId: true, shareMeta: true, version: true },
      });
      const error = await getError(() =>
        enableShareView({ tableId: table.id, viewId: created.data.id })
      );

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({ domainCode: 'validation.invalid' });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: created.data.id },
          select: { enableShare: true, shareId: true, shareMeta: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(JSON.parse(rowBefore.shareMeta!)).toEqual({
        allowCopy: false,
        includeHiddenField: true,
      });
      expect(legacyEnableSpy).not.toHaveBeenCalled();
    });

    it('serializes concurrent enable and refresh mutations by View version', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBeforeEnable = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });

      const enableResults = await Promise.allSettled([
        enableShareView({ tableId: table.id, viewId: view.id }),
        enableShareView({ tableId: table.id, viewId: view.id }),
      ]);
      const enabled = enableResults.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof enableShareView>>> =>
          result.status === 'fulfilled'
      );
      const enableRejected = enableResults.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );

      expect(enabled).toHaveLength(1);
      expect(enableRejected).toHaveLength(1);
      expect(enableRejected[0]?.reason).toMatchObject({
        status: 400,
        data: { domainCode: 'view.version_conflict' },
      });
      const enabledShareId = enabled[0]!.value.data.shareId;
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { enableShare: true, shareId: true, version: true },
        })
      ).resolves.toEqual({
        enableShare: true,
        shareId: enabledShareId,
        version: rowBeforeEnable.version + 1,
      });
      await expect(getShareView(enabledShareId)).resolves.toMatchObject({
        data: { viewId: view.id, shareId: enabledShareId },
      });

      const rowBeforeRefresh = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const refreshResults = await Promise.allSettled([
        refreshViewShareId(table.id, view.id),
        refreshViewShareId(table.id, view.id),
      ]);
      const refreshed = refreshResults.filter(
        (
          result
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof refreshViewShareId>>> =>
          result.status === 'fulfilled'
      );
      const refreshRejected = refreshResults.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );

      expect(refreshed).toHaveLength(1);
      expect(refreshRejected).toHaveLength(1);
      expect(refreshRejected[0]?.reason).toMatchObject({
        status: 400,
        data: { domainCode: 'view.version_conflict' },
      });
      const refreshedShareId = refreshed[0]!.value.data.shareId;
      expect(refreshedShareId).not.toBe(enabledShareId);
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { shareId: true, version: true },
        })
      ).resolves.toEqual({
        shareId: refreshedShareId,
        version: rowBeforeRefresh.version + 1,
      });
      await expect(getShareView(enabledShareId)).rejects.toThrow();
      await expect(getShareView(refreshedShareId)).resolves.toMatchObject({
        data: { viewId: view.id, shareId: refreshedShareId },
      });
    });

    it('disables sharing, permanently revokes the credential, and re-enables with a new ID', async () => {
      const view = (await getViews(table.id))[0]!;
      const enabled = await enableShareView({ tableId: table.id, viewId: view.id });
      const oldShareId = enabled.data.shareId;
      const oldShortLink = await createShortLink({
        type: ShortLinkType.ViewShare,
        resourceId: oldShareId,
      });
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { version: true },
      });
      const legacyDisableSpy = vi
        .spyOn(viewOpenApiService, 'disableShare')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyOpsSpy = vi
        .spyOn(viewService, 'updateViewByOps')
        .mockRejectedValue(new Error('legacy ViewService must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const response = await disableShareView({ tableId: table.id, viewId: view.id });

      expect(response.status).toBe(201);
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('disableViewShare');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { enableShare: true, shareId: true, version: true },
        })
      ).resolves.toEqual({
        enableShare: false,
        shareId: oldShareId,
        version: rowBefore.version + 1,
      });
      await expect(getShareView(oldShareId)).rejects.toThrow();
      expect((await getError(() => getShortLink(oldShortLink.data.code)))?.status).toBe(404);

      const reEnabled = await enableShareView({ tableId: table.id, viewId: view.id });
      expect(reEnabled.data.shareId).not.toBe(oldShareId);
      await expect(getShareView(oldShareId)).rejects.toThrow();
      expect(legacyDisableSpy).not.toHaveBeenCalled();
      expect(legacyOpsSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('rejects repeated disable without changing the persisted View', async () => {
      const view = (await getViews(table.id))[0]!;
      const rowBefore = await prismaService.view.findUniqueOrThrow({
        where: { id: view.id },
        select: { enableShare: true, shareId: true, shareMeta: true, version: true },
      });
      const legacyDisableSpy = vi.spyOn(viewOpenApiService, 'disableShare');

      const error = await getError(() => disableShareView({ tableId: table.id, viewId: view.id }));

      expect(error?.status).toBe(400);
      expect(error?.data).toMatchObject({ domainCode: 'validation.invalid' });
      await expect(
        prismaService.view.findUniqueOrThrow({
          where: { id: view.id },
          select: { enableShare: true, shareId: true, shareMeta: true, version: true },
        })
      ).resolves.toEqual(rowBefore);
      expect(legacyDisableSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['enable', (tableId: string, viewId: string) => enableShareView({ tableId, viewId })],
      ['disable', (tableId: string, viewId: string) => disableShareView({ tableId, viewId })],
    ])(
      'rejects cross-Table %s without crossing the aggregate boundary',
      async (operation, call) => {
        const anotherTable = await createTable(baseId, { name: `${operation}_share_other_table` });
        try {
          const anotherView = (await getViews(anotherTable.id))[0]!;
          if (operation === 'disable') {
            await enableShareView({ tableId: anotherTable.id, viewId: anotherView.id });
          }
          const rowBefore = await prismaService.view.findUniqueOrThrow({
            where: { id: anotherView.id },
            select: { enableShare: true, shareId: true, version: true },
          });

          const error = await getError(() => call(table.id, anotherView.id));

          expect(error?.status).toBe(404);
          expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
          await expect(
            prismaService.view.findUniqueOrThrow({
              where: { id: anotherView.id },
              select: { enableShare: true, shareId: true, version: true },
            })
          ).resolves.toEqual(rowBefore);
        } finally {
          await permanentDeleteTable(baseId, anotherTable.id);
        }
      }
    );
  });

  describe('/api/table/{tableId}/view/:viewId/column-meta (PUT)', () => {
    let tableId: string;
    let gridViewId: string;
    let formViewId: string;
    beforeAll(async () => {
      const table = await createTable(baseId, { name: 'table' });
      tableId = table.id;
      const gridView = await createView(table.id, {
        name: 'Grid view',
        type: ViewType.Grid,
      });
      gridViewId = gridView.id;
      const formView = await createView(table.id, {
        name: 'Form view',
        type: ViewType.Form,
      });
      formViewId = formView.id;
      await enableShareView({ tableId, viewId: formViewId });
      await enableShareView({ tableId, viewId: gridViewId });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, tableId);
    });

    it('update allowCopy success', async () => {
      await updateViewShareMeta(tableId, gridViewId, { allowCopy: true });
      const view = await getView(tableId, gridViewId);
      expect(view.shareMeta?.allowCopy).toBe(true);
    });

    it.each(VIEW_DEFAULT_SHARE_META)(
      'viewType($viewType) with enabled share with default shareMeta',
      async (viewShareDefault) => {
        const view = await createView(tableId, {
          name: `${viewShareDefault.viewType} view`,
          type: viewShareDefault.viewType,
        });
        await enableShareView({ tableId, viewId: view.id });
        const { shareMeta } = await getView(tableId, view.id);
        expect(shareMeta).toEqual(viewShareDefault.defaultShareMeta);
      }
    );

    it('stores submit.requireLogin on form views', async () => {
      await updateViewShareMeta(tableId, formViewId, { submit: { requireLogin: true } });
      const view = await getView(tableId, formViewId);
      expect(view.shareMeta?.submit?.requireLogin).toBe(true);
    });
  });

  describe('filter by view ', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should get records with a field filtered view', async () => {
      const res = await createView(table.id, {
        name: 'view1',
        type: ViewType.Grid,
      });

      await updateViewColumnMeta(table.id, res.id, [
        {
          fieldId: table.fields[1].id,
          columnMeta: {
            hidden: true,
          },
        },
      ]);

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table.fields[0].id]: 'text',
            [table.fields[1].id]: 1,
          },
        },
      });

      const recordResult = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: res.id,
      });
      const fieldResult = await getFields(table.id, res.id);

      expect(recordResult.data.records[0].fields[table.fields[0].id]).toEqual('text');
      expect(recordResult.data.records[0].fields[table.fields[1].id]).toBeUndefined();

      expect(fieldResult.length).toEqual(table.fields.length - 1);
      expect(fieldResult.find((field) => field.id === table.fields[1].id)).toBeUndefined();
    });
  });

  it('should reject reading filter link records through another table', async () => {
    const anotherTable = await createTable(baseId, { name: 'another_filter_table' });

    try {
      const [anotherView] = await getViews(anotherTable.id);

      await expect(getViewFilterLinkRecords(table.id, anotherView.id)).rejects.toThrow();
    } finally {
      await permanentDeleteTable(baseId, anotherTable.id);
    }
  });

  describe('View socket read endpoints v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    const getSocketDocIds = () =>
      axios.get<{ ids: string[] }>(`/table/${table.id}/view/socket/doc-ids`);
    const getSocketSnapshots = (ids?: string[]) =>
      axios.get<
        Array<{
          id: string;
          v: number;
          type: string;
          data: { id: string; name: string; columnMeta: Record<string, unknown> };
        }>
      >(`/table/${table.id}/view/socket/snapshot-bulk`, {
        ...(ids !== undefined ? { params: { ids } } : {}),
      });

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('returns ordered doc IDs and requested snapshots from the Table aggregate', async () => {
      const first = (
        await createViewApi(table.id, {
          name: 'Socket first',
          type: ViewType.Grid,
        })
      ).data;
      const second = (
        await createViewApi(table.id, {
          name: 'Socket second',
          type: ViewType.Kanban,
        })
      ).data;
      const activeFieldId = table.fields[0].id;
      await prismaService.view.update({
        where: { id: first.id },
        data: {
          columnMeta: JSON.stringify({
            [activeFieldId]: { order: 0, width: 220 },
            [`fld${'z'.repeat(16)}`]: { order: 1, width: 300 },
          }),
        },
      });
      const legacyDocIdsSpy = vi
        .spyOn(viewService, 'getDocIdsByQuery')
        .mockRejectedValue(new Error('legacy View doc IDs must not be used'));
      const legacySnapshotsSpy = vi
        .spyOn(viewService, 'getSnapshotBulk')
        .mockRejectedValue(new Error('legacy View snapshots must not be used'));

      const docIdsResponse = await getSocketDocIds();
      const snapshotsResponse = await getSocketSnapshots([second.id, first.id]);

      expect(docIdsResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(docIdsResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getViewSocketDocIds');
      expect(docIdsResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(docIdsResponse.data.ids).toEqual((await getViews(table.id)).map((view) => view.id));
      expect(snapshotsResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(snapshotsResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe(
        'getViewSocketSnapshotBulk'
      );
      expect(snapshotsResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(snapshotsResponse.data.map((snapshot) => snapshot.id)).toEqual([second.id, first.id]);
      expect(snapshotsResponse.data.map((snapshot) => snapshot.type)).toEqual(['json0', 'json0']);
      expect(snapshotsResponse.data[1].data).toMatchObject({
        id: first.id,
        name: 'Socket first',
        columnMeta: {
          [activeFieldId]: { order: 0, width: 220 },
        },
      });
      expect(snapshotsResponse.data[1].data.columnMeta).not.toHaveProperty(`fld${'z'.repeat(16)}`);
      expect(legacyDocIdsSpy).not.toHaveBeenCalled();
      expect(legacySnapshotsSpy).not.toHaveBeenCalled();
    });

    it('projects legacy column metadata entries that are missing order', async () => {
      const created = (
        await createViewApi(table.id, {
          name: 'Socket legacy column metadata',
          type: ViewType.Grid,
        })
      ).data;
      const field = table.fields.at(-1)!;

      await prismaService.view.update({
        where: { id: created.id },
        data: {
          columnMeta: JSON.stringify({
            [field.id]: { width: 241 },
          }),
        },
      });

      const viewFromList = (await getViews(table.id)).find((view) => view.id === created.id);
      const snapshot = (await getSocketSnapshots([created.id])).data[0];

      expect(viewFromList?.columnMeta[field.id]).toEqual({
        order: table.fields.length - 1,
        width: 241,
      });
      expect(snapshot.data.columnMeta[field.id]).toEqual({
        order: table.fields.length - 1,
        width: 241,
      });
    });

    it('projects legacy column metadata entries that mix visible and hidden', async () => {
      const created = (
        await createViewApi(table.id, {
          name: 'Socket legacy mixed visibility metadata',
          type: ViewType.Grid,
        })
      ).data;
      const field = table.fields.at(-1)!;

      await prismaService.view.update({
        where: { id: created.id },
        data: {
          columnMeta: JSON.stringify({
            [field.id]: {
              order: table.fields.length - 1,
              visible: true,
              hidden: false,
              width: 241,
            },
          }),
        },
      });

      const viewFromList = (await getViews(table.id)).find((view) => view.id === created.id);
      const snapshot = (await getSocketSnapshots([created.id])).data[0];

      expect(viewFromList?.columnMeta[field.id]).toEqual({
        order: table.fields.length - 1,
        hidden: false,
        width: 241,
      });
      expect(snapshot.data.columnMeta[field.id]).toEqual({
        order: table.fields.length - 1,
        hidden: false,
        width: 241,
      });
    });

    it('returns the persisted View version and advances it after a v2 mutation', async () => {
      const created = (
        await createViewApi(table.id, {
          name: 'Versioned socket',
          type: ViewType.Gallery,
        })
      ).data;

      const before = (await getSocketSnapshots([created.id])).data[0];
      await updateViewName(table.id, created.id, { name: 'Versioned socket updated' });
      const after = (await getSocketSnapshots([created.id])).data[0];

      expect(before.v).toBeGreaterThanOrEqual(1);
      expect(after.v).toBe(before.v + 1);
      expect(after.data).toMatchObject({
        id: created.id,
        name: 'Versioned socket updated',
      });
      expect(after.data).not.toHaveProperty('version');
    });

    it('rejects missing, foreign, deleted, and duplicate View children without using v1', async () => {
      const anotherTable = await createTable(baseId, { name: 'socket_other_table' });
      const deleted = (
        await createViewApi(table.id, {
          name: 'Deleted socket',
          type: ViewType.Grid,
        })
      ).data;
      await deleteView(table.id, deleted.id);
      const foreignViewId = anotherTable.views[0].id;
      const existingViewId = table.views[0].id;
      const legacySnapshotsSpy = vi.spyOn(viewService, 'getSnapshotBulk');

      try {
        for (const ids of [
          [`viw${'z'.repeat(16)}`],
          [foreignViewId],
          [deleted.id],
          [existingViewId, existingViewId],
        ]) {
          const error = await getError(() => getSocketSnapshots(ids));
          expect(error?.status).toBe(404);
          expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
        }
        expect(legacySnapshotsSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('validates malformed IDs and supports an empty snapshot request entirely in v2', async () => {
      const invalidError = await getError(() => getSocketSnapshots(['invalid']));
      const emptyResponse = await getSocketSnapshots();

      expect(invalidError?.status).toBe(400);
      expect(invalidError?.data).toMatchObject({ domainCode: 'validation.invalid' });
      expect(emptyResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getViewSocketSnapshotBulk');
      expect(emptyResponse.data).toEqual([]);
    });
  });

  describe('Plugin View endpoints v2 canary (T6420)', () => {
    let previousForceV2All: string | undefined;

    beforeEach(() => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2All;
    });

    it('installs and reads a Plugin View through v2 with the plugin default name', async () => {
      const plugin = await prismaService.plugin.findUniqueOrThrow({
        where: { id: 'plgsheetform' },
        select: { name: true, logo: true },
      });
      const legacyInstallSpy = vi
        .spyOn(viewOpenApiService, 'pluginInstall')
        .mockRejectedValue(new Error('legacy Plugin View install must not be used'));
      const legacyReadSpy = vi
        .spyOn(viewOpenApiService, 'getPluginInstall')
        .mockRejectedValue(new Error('legacy Plugin View read must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');

      const installResponse = await installViewPlugin(table.id, {
        pluginId: 'plgsheetform',
      });
      const installed = installResponse.data;

      expect(installResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(installResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('installViewPlugin');
      expect(installResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(installed).toMatchObject({
        pluginId: 'plgsheetform',
        name: plugin.name,
      });
      expect(installed.pluginInstallId).toMatch(/^pli[0-9a-zA-Z]{16}$/);
      expect(installed.viewId).toMatch(/^viw[0-9a-zA-Z]{16}$/);

      const view = await getView(table.id, installed.viewId);
      expect(view).toMatchObject({
        id: installed.viewId,
        name: plugin.name,
        type: ViewType.Plugin,
        options: {
          pluginId: 'plgsheetform',
          pluginInstallId: installed.pluginInstallId,
          pluginLogo: expect.stringContaining(plugin.logo),
        },
      });

      const readResponse = await getViewInstallPlugin(table.id, installed.viewId);
      expect(readResponse.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(readResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getViewPluginInstall');
      expect(readResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(readResponse.data).toMatchObject({
        baseId,
        pluginId: 'plgsheetform',
        pluginInstallId: installed.pluginInstallId,
        name: plugin.name,
      });
      expect(readResponse.data.storage).toBeUndefined();
      expect(legacyInstallSpy).not.toHaveBeenCalled();
      expect(legacyReadSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('preserves an explicit install name', async () => {
      const response = await installViewPlugin(table.id, {
        name: 'My sheet',
        pluginId: 'plgsheetform',
      });

      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('installViewPlugin');
      expect(response.data.name).toBe('My sheet');
      await expect(getView(table.id, response.data.viewId)).resolves.toMatchObject({
        name: 'My sheet',
      });
    });

    it('rejects a missing plugin without creating a View or installation', async () => {
      const viewsBefore = await getViews(table.id);
      const legacyInstallSpy = vi.spyOn(viewOpenApiService, 'pluginInstall');

      const error = await getError(() =>
        installViewPlugin(table.id, {
          pluginId: 'plg-missing-direct-install',
        })
      );

      expect(error?.status).toBe(404);
      expect(error?.data).toMatchObject({ domainCode: 'not_found' });
      await expect(getViews(table.id)).resolves.toHaveLength(viewsBefore.length);
      expect(legacyInstallSpy).not.toHaveBeenCalled();
    });

    it('rejects a plugin that does not support the View position', async () => {
      const plugin = await createPlugin({
        name: 'Dash-only install',
        logo: 'https://example.test/dashboard-only.png',
        positions: [PluginPosition.Dashboard],
      });
      const viewsBefore = await getViews(table.id);
      try {
        await submitPlugin(plugin.data.id);
        await publishPlugin(plugin.data.id);
        const error = await getError(() =>
          installViewPlugin(table.id, {
            pluginId: plugin.data.id,
          })
        );

        expect(error?.status).toBe(400);
        expect(error?.data).toMatchObject({ domainCode: 'validation.invalid' });
        await expect(getViews(table.id)).resolves.toHaveLength(viewsBefore.length);
      } finally {
        await deletePlugin(plugin.data.id);
      }
    });

    it('rejects reading a non-Plugin View without bypassing the Table aggregate', async () => {
      const view = (await getViews(table.id))[0]!;
      const legacyReadSpy = vi.spyOn(viewOpenApiService, 'getPluginInstall');

      const error = await getError(() => getViewInstallPlugin(table.id, view.id));

      expect(error?.status).toBe(404);
      expect(error?.data).toMatchObject({ domainCode: 'not_found' });
      expect(legacyReadSpy).not.toHaveBeenCalled();
    });

    it('updates and reads nested plugin storage through v2 Kysely', async () => {
      const installed = (
        await installViewPlugin(table.id, {
          name: 'Storage sheet',
          pluginId: 'plgsheetform',
        })
      ).data;
      const legacyUpdateSpy = vi
        .spyOn(viewOpenApiService, 'updatePluginStorage')
        .mockRejectedValue(new Error('legacy Plugin View storage update must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
      const storage = {
        version: 2,
        sheets: {
          sheet1: {
            rows: [{ id: 'row-1', values: [true, 42, 'text'] }],
          },
        },
      };

      const response = await updateViewPluginStorage(
        table.id,
        installed.viewId,
        installed.pluginInstallId,
        storage
      );

      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewPluginStorage');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      expect(response.data).toEqual({
        tableId: table.id,
        viewId: installed.viewId,
        pluginInstallId: installed.pluginInstallId,
        storage,
      });
      await expect(getViewInstallPlugin(table.id, installed.viewId)).resolves.toMatchObject({
        data: { storage },
      });
      await expect(
        prismaService.pluginInstall.findUniqueOrThrow({
          where: { id: installed.pluginInstallId },
          select: { storage: true, lastModifiedBy: true },
        })
      ).resolves.toEqual({
        storage: JSON.stringify(storage),
        lastModifiedBy: globalThis.testConfig.userId,
      });
      expect(legacyUpdateSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('treats omitted storage as a validated no-op and preserves the existing payload', async () => {
      const installed = (
        await installViewPlugin(table.id, {
          name: 'No-op storage sheet',
          pluginId: 'plgsheetform',
        })
      ).data;
      const storage = { keep: { nested: true } };
      await updateViewPluginStorage(table.id, installed.viewId, installed.pluginInstallId, storage);
      const rowBefore = await prismaService.pluginInstall.findUniqueOrThrow({
        where: { id: installed.pluginInstallId },
        select: { storage: true, lastModifiedTime: true, lastModifiedBy: true },
      });

      const response = await updateViewPluginStorage(
        table.id,
        installed.viewId,
        installed.pluginInstallId
      );

      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('updateViewPluginStorage');
      expect(response.data).toEqual({
        tableId: table.id,
        viewId: installed.viewId,
        pluginInstallId: installed.pluginInstallId,
      });
      await expect(getViewInstallPlugin(table.id, installed.viewId)).resolves.toMatchObject({
        data: { storage },
      });
      await expect(
        prismaService.pluginInstall.findUniqueOrThrow({
          where: { id: installed.pluginInstallId },
          select: { storage: true, lastModifiedTime: true, lastModifiedBy: true },
        })
      ).resolves.toEqual(rowBefore);
    });

    it('rejects cross-Table reads and mismatched installations without changing storage', async () => {
      const anotherTable = await createTable(baseId, { name: 'plugin_v2_other_table' });
      try {
        const ownPlugin = (
          await installViewPlugin(table.id, {
            name: 'Own plugin',
            pluginId: 'plgsheetform',
          })
        ).data;
        const anotherPlugin = (
          await installViewPlugin(anotherTable.id, {
            name: 'Other plugin',
            pluginId: 'plgsheetform',
          })
        ).data;
        const legacyReadSpy = vi.spyOn(viewOpenApiService, 'getPluginInstall');
        const legacyUpdateSpy = vi.spyOn(viewOpenApiService, 'updatePluginStorage');

        const readError = await getError(() =>
          getViewInstallPlugin(table.id, anotherPlugin.viewId)
        );
        const mismatchedError = await getError(() =>
          updateViewPluginStorage(table.id, ownPlugin.viewId, anotherPlugin.pluginInstallId, {
            unauthorized: true,
          })
        );
        const crossTableError = await getError(() =>
          updateViewPluginStorage(table.id, anotherPlugin.viewId, anotherPlugin.pluginInstallId, {
            unauthorized: true,
          })
        );

        expect(readError?.status).toBe(404);
        expect(mismatchedError?.status).toBe(404);
        expect(crossTableError?.status).toBe(404);
        expect(
          (await getViewInstallPlugin(table.id, ownPlugin.viewId)).data.storage
        ).toBeUndefined();
        expect(
          (await getViewInstallPlugin(anotherTable.id, anotherPlugin.viewId)).data.storage
        ).toBeUndefined();
        expect(legacyReadSpy).not.toHaveBeenCalled();
        expect(legacyUpdateSpy).not.toHaveBeenCalled();
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });
  });

  describe('view plugin parent binding', () => {
    let anotherTable: ITableFullVo;

    beforeEach(async () => {
      anotherTable = await createTable(baseId, { name: 'another_plugin_table' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, anotherTable.id);
    });

    it('should reject reading a plugin installation through another table', async () => {
      const plugin = (
        await installViewPlugin(anotherTable.id, {
          name: 'another_sheet_view',
          pluginId: 'plgsheetform',
        })
      ).data;

      await expect(getViewInstallPlugin(table.id, plugin.viewId)).rejects.toThrow();
    });

    it('should reject updating storage with a plugin installation from another view', async () => {
      const ownPlugin = (
        await installViewPlugin(table.id, {
          name: 'own_sheet_view',
          pluginId: 'plgsheetform',
        })
      ).data;
      const anotherPlugin = (
        await installViewPlugin(anotherTable.id, {
          name: 'another_sheet_view',
          pluginId: 'plgsheetform',
        })
      ).data;

      await expect(
        updateViewPluginStorage(table.id, ownPlugin.viewId, anotherPlugin.pluginInstallId, {
          unauthorized: true,
        })
      ).rejects.toThrow();
      await expect(
        updateViewPluginStorage(table.id, anotherPlugin.viewId, anotherPlugin.pluginInstallId, {
          unauthorized: true,
        })
      ).rejects.toThrow();

      const pluginAfter = await getViewInstallPlugin(table.id, ownPlugin.viewId);
      const anotherPluginAfter = await getViewInstallPlugin(anotherTable.id, anotherPlugin.viewId);
      expect(pluginAfter.data.storage).toBeUndefined();
      expect(anotherPluginAfter.data.storage).toBeUndefined();
    });
  });

  describe('/api/table/{tableId}/view/:viewId/duplicate (POST)', () => {
    let table: ITableFullVo;
    let previousForceV2All: string | undefined;

    const expectDuplicateV2 = (response: { headers: Record<string, unknown> }) => {
      expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('duplicateView');
      expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    };

    beforeEach(async () => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
      vi.restoreAllMocks();
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('should reject duplicating a view through another table', async () => {
      const anotherTable = await createTable(baseId, { name: 'another_duplicate_table' });

      try {
        const [anotherView] = await getViews(anotherTable.id);

        const error = await getError(() => duplicateView(table.id, anotherView.id));

        expect(error?.status).toBe(404);
        expect(error?.data).toMatchObject({ domainCode: 'view.not_found' });
      } finally {
        await permanentDeleteTable(baseId, anotherTable.id);
      }
    });

    it('should duplicate grid view', async () => {
      const view = await createView(table.id, {
        name: 'grid_view',
        type: ViewType.Grid,
        description: 'duplicate every Grid property',
        filter: {
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'text',
              operator: 'is',
            },
          ],
          conjunction: 'and',
        },
        isLocked: true,
        enableShare: true,
        shareId: `shr${'g'.repeat(16)}`,
        shareMeta: {
          allowCopy: false,
          includeHiddenField: true,
          submit: { requireLogin: true },
        },
        sort: {
          sortObjs: [
            {
              fieldId: table.fields[0].id,
              order: SortFunc.Asc,
            },
          ],
          manualSort: false,
        },
        group: [
          {
            fieldId: table.fields[0].id,
            order: SortFunc.Asc,
          },
        ],
        options: {
          rowHeight: RowHeightLevel.Medium,
        },
        columnMeta: {
          [table.fields[0].id]: {
            hidden: true,
            order: 1,
          },
        },
      });

      const legacyDuplicateSpy = vi
        .spyOn(viewOpenApiService, 'duplicateView')
        .mockRejectedValue(new Error('legacy ViewOpenApiService must not be used'));
      const legacyCreateSpy = vi
        .spyOn(viewService, 'createView')
        .mockRejectedValue(new Error('legacy ViewService.createView must not be used'));
      const legacyReadSpy = vi
        .spyOn(viewService, 'getViewById')
        .mockRejectedValue(new Error('legacy ViewService.getViewById must not be used'));
      const eventSpy = vi.spyOn(eventEmitterService, 'emitAsync');
      const duplicatedViewResponse = await duplicateView(table.id, view.id);
      const duplicatedView = duplicatedViewResponse.data;
      const { dbTableName } = await prismaService.tableMeta.findUniqueOrThrow({
        where: { id: table.id },
        select: { dbTableName: true },
      });
      const duplicatedRowOrderColumn = await viewService.existIndex(
        dbTableName,
        duplicatedView.id,
        prismaService.txClient()
      );

      expect(duplicatedView.name).toEqual('grid_view 2');
      expect(duplicatedView.type).toEqual(ViewType.Grid);
      expect(duplicatedView.description).toEqual(view.description);
      expect(duplicatedView.filter).toEqual(view.filter);
      expect(duplicatedView.sort).toEqual(view.sort);
      expect(duplicatedView.group).toEqual(view.group);
      expect(duplicatedView.options).toEqual(view.options);
      expect(duplicatedView.columnMeta).toEqual(view.columnMeta);
      expect(duplicatedView.isLocked).toBeTruthy();
      expect(duplicatedView.enableShare).toBe(true);
      expect(duplicatedView.shareMeta).toEqual(view.shareMeta);
      expect(duplicatedView.shareId).toMatch(/^shr[0-9a-zA-Z]{16}$/);
      expect(duplicatedView.shareId).not.toBe(view.shareId);
      expect(duplicatedView.createdBy).toBeTruthy();
      expect(duplicatedView.createdTime).toBeTruthy();
      expect(duplicatedRowOrderColumn).toBeDefined();
      expectDuplicateV2(duplicatedViewResponse);
      expect(legacyDuplicateSpy).not.toHaveBeenCalled();
      expect(legacyCreateSpy).not.toHaveBeenCalled();
      expect(legacyReadSpy).not.toHaveBeenCalled();
      expectNoLegacyViewEvent(eventSpy);
    });

    it('should duplicate form view', async () => {
      const initialColumnMeta = table.fields.reduce<Record<string, IFormColumnMeta>>(
        (pre, cur, index) => {
          pre[cur.id] = {
            order: index,
          } as unknown as IFormColumnMeta;
          if (index === 0) {
            (pre[cur.id] as unknown as IFormColumn).required = true;
          }
          if (!cur.isComputed && cur.type !== FieldType.Button) {
            (pre[cur.id] as unknown as IFormColumn).visible = true;
          }
          return pre;
        },
        {} as Record<string, IFormColumnMeta>
      );
      const formView = await createView(table.id, {
        name: 'form_view',
        type: ViewType.Form,
        columnMeta: {
          ...(initialColumnMeta as unknown as Record<string, IColumn>),
        },
      });

      const duplicatedResponse = await duplicateView(table.id, formView.id);
      const duplicatedView = duplicatedResponse.data;

      expectDuplicateV2(duplicatedResponse);
      expect(duplicatedView.name).toEqual('form_view 2');
      expect(duplicatedView.type).toEqual(ViewType.Form);
      expect(duplicatedView.options).toEqual(formView.options);
      expect(duplicatedView.columnMeta).toEqual(initialColumnMeta);
      expect(duplicatedView.shareId).toBeUndefined();
    });

    it('should duplicate gallery view', async () => {
      const attachmentField = await createField(table.id, {
        name: 'Attachment',
        type: FieldType.Attachment,
      });
      const galleryView = await createView(table.id, {
        name: 'gallery_view',
        type: ViewType.Gallery,
        filter: {
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'text',
              operator: 'is',
            },
          ],
          conjunction: 'and',
        },
        sort: {
          sortObjs: [
            {
              fieldId: table.fields[0].id,
              order: SortFunc.Asc,
            },
          ],
        },
        options: {
          coverFieldId: attachmentField.id,
        },
      });

      const duplicatedResponse = await duplicateView(table.id, galleryView.id);
      const duplicatedView = duplicatedResponse.data;
      expectDuplicateV2(duplicatedResponse);
      expect(duplicatedView.name).toEqual('gallery_view 2');
      expect(duplicatedView.type).toEqual(ViewType.Gallery);
      expect(duplicatedView.filter).toEqual(galleryView.filter);
      expect(duplicatedView.sort).toEqual(galleryView.sort);
      expect(duplicatedView.options).toEqual({
        coverFieldId: attachmentField.id,
      });
    });

    it('preserves explicit null and false Gallery options without replaying Create defaults', async () => {
      const attachmentField = await createField(table.id, {
        name: 'Optional cover',
        type: FieldType.Attachment,
      });
      const galleryView = await createView(table.id, {
        name: 'gallery_without_cover',
        type: ViewType.Gallery,
        options: {
          coverFieldId: attachmentField.id,
        },
      });
      await prismaService.view.update({
        where: { id: galleryView.id },
        data: {
          options: JSON.stringify({
            coverFieldId: null,
            isCoverFit: false,
            isFieldNameHidden: false,
          }),
        },
      });

      const duplicatedResponse = await duplicateView(table.id, galleryView.id);

      expectDuplicateV2(duplicatedResponse);
      expect(duplicatedResponse.data.options).toEqual({
        coverFieldId: null,
        isCoverFit: false,
        isFieldNameHidden: false,
      });
    });

    it('should duplicate kanban view', async () => {
      const kanbanView = await createView(table.id, {
        name: 'kanban_view',
        type: ViewType.Kanban,
        filter: {
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'text',
              operator: 'is',
            },
          ],
          conjunction: 'and',
        },
        sort: {
          sortObjs: [
            {
              fieldId: table.fields[0].id,
              order: SortFunc.Asc,
            },
          ],
        },
        options: {
          stackFieldId: table.fields[0].id,
        },
      });

      const duplicatedResponse = await duplicateView(table.id, kanbanView.id);
      const duplicatedView = duplicatedResponse.data;
      expectDuplicateV2(duplicatedResponse);
      expect(duplicatedView.name).toEqual('kanban_view 2');
      expect(duplicatedView.type).toEqual(ViewType.Kanban);
      expect(duplicatedView.filter).toEqual(kanbanView.filter);
      expect(duplicatedView.sort).toEqual(kanbanView.sort);
      expect(duplicatedView.columnMeta).toEqual(kanbanView.columnMeta);
      expect(duplicatedView.options).toEqual({
        stackFieldId: table.fields[0].id,
      });
    });

    it('should duplicate calendar view', async () => {
      const startDateField = await createField(table.id, {
        name: 'Start Date',
        type: FieldType.Date,
      });
      const endDateField = await createField(table.id, {
        name: 'End Date',
        type: FieldType.Date,
      });
      const calendarView = await createView(table.id, {
        name: 'calendar_view',
        type: ViewType.Calendar,
        filter: {
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'text',
              operator: 'is',
            },
          ],
          conjunction: 'and',
        },
        options: {
          startDateFieldId: startDateField.id,
          endDateFieldId: endDateField.id,
          colorConfig: {
            type: ColorConfigType.Custom,
            color: Colors.PurpleLight2,
          },
          titleFieldId: table.fields[0].id,
        },
      });

      const duplicatedResponse = await duplicateView(table.id, calendarView.id);
      const duplicatedView = duplicatedResponse.data;
      expectDuplicateV2(duplicatedResponse);
      expect(duplicatedView.name).toEqual('calendar_view 2');
      expect(duplicatedView.type).toEqual(ViewType.Calendar);
      expect(duplicatedView.filter).toEqual(calendarView.filter);
      expect(duplicatedView.sort).toEqual(calendarView.sort);
      expect(duplicatedView.options).toEqual(calendarView.options);
      expect(duplicatedView.columnMeta).toEqual(calendarView.columnMeta);
      expect(duplicatedView.options).toEqual({
        startDateFieldId: startDateField.id,
        endDateFieldId: endDateField.id,
        colorConfig: {
          type: ColorConfigType.Custom,
          color: Colors.PurpleLight2,
        },
        titleFieldId: table.fields[0].id,
      });
    });

    it('should duplicate a plugin view with historical stale install options', async () => {
      const sheetPlugin = (
        await installViewPlugin(table.id, {
          name: 'sheet_view',
          pluginId: 'plgsheetform',
        })
      ).data;
      const storage = { imported: true };
      await updateViewPluginStorage(
        table.id,
        sheetPlugin.viewId,
        sheetPlugin.pluginInstallId,
        storage
      );
      const sheetView = await getView(table.id, sheetPlugin.viewId);
      await prismaService.view.update({
        where: { id: sheetView.id },
        data: {
          options: JSON.stringify({
            ...(sheetView.options as IPluginViewOptions),
            pluginInstallId: generatePluginInstallId(),
          }),
        },
      });

      const resolvedInstall = (await getViewInstallPlugin(table.id, sheetView.id)).data;
      expect(resolvedInstall.pluginInstallId).toBe(sheetPlugin.pluginInstallId);

      const legacyDuplicateSpy = vi
        .spyOn(viewOpenApiService, 'duplicateView')
        .mockRejectedValue(new Error('Plugin duplication must not fall back to v1'));
      const duplicatedResponse = await duplicateView(table.id, sheetView.id);
      const duplicatedView = duplicatedResponse.data;
      const duplicatedInstall = (await getViewInstallPlugin(table.id, duplicatedView.id)).data;
      expectDuplicateV2(duplicatedResponse);
      expect(duplicatedView.name).toEqual('sheet_view 2');
      expect(duplicatedView.type).toEqual(ViewType.Plugin);
      expect(duplicatedView.options).contain({
        pluginLogo: (sheetView.options as IPluginViewOptions).pluginLogo,
      });
      expect(duplicatedInstall.pluginInstallId).toBe(
        (duplicatedView.options as IPluginViewOptions).pluginInstallId
      );
      expect(duplicatedInstall.pluginInstallId).not.toBe(sheetPlugin.pluginInstallId);
      expect(duplicatedInstall.storage).toEqual(storage);
      expect(legacyDuplicateSpy).not.toHaveBeenCalled();
    });

    it('owns numeric suffix collision resolution inside the Table aggregate', async () => {
      const source = await createView(table.id, {
        name: 'Sprint 2',
        type: ViewType.Grid,
      });
      await createView(table.id, {
        name: 'Sprint 3',
        type: ViewType.Grid,
      });

      const response = await duplicateView(table.id, source.id);

      expectDuplicateV2(response);
      expect(response.data.name).toBe('Sprint 4');
    });

    it('fails atomically when the source Plugin installation is missing', async () => {
      const plugin = (
        await installViewPlugin(table.id, {
          name: 'missing_install_source',
          pluginId: 'plgsheetform',
        })
      ).data;
      const beforeViews = await getViews(table.id);
      await prismaService.pluginInstall.delete({
        where: { id: plugin.pluginInstallId },
      });

      const error = await getError(() => duplicateView(table.id, plugin.viewId));
      const afterViews = await getViews(table.id);

      expect(error?.status).toBe(404);
      expect(error?.data).toMatchObject({ domainCode: 'not_found' });
      expect(afterViews.map((view) => view.id)).toEqual(beforeViews.map((view) => view.id));
    });
  });

  describe('concurrent view deletion with row-level locking', () => {
    let table: ITableFullVo;
    let view1Id: string;
    let view2Id: string;
    let previousForceV2All: string | undefined;

    beforeEach(async () => {
      previousForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'true';
      table = await createTable(baseId, { name: 'concurrent_test_table' });
      const view1 = await createView(table.id, {
        name: 'View 1',
        type: ViewType.Grid,
      });
      view1Id = view1.id;
      const view2 = await createView(table.id, {
        name: 'View 2',
        type: ViewType.Grid,
      });
      view2Id = view2.id;
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
      if (previousForceV2All == null) {
        delete process.env.FORCE_V2_ALL;
      } else {
        process.env.FORCE_V2_ALL = previousForceV2All;
      }
    });

    it('should prevent concurrent deletion of the last view using SELECT FOR UPDATE', async () => {
      // Delete view1 first (should succeed since there are still 2 views left)
      await deleteView(table.id, view1Id);

      // Verify view1 was deleted
      const views = await getViews(table.id);
      expect(views.length).toBe(2); // default view + view2

      // Try to delete the second custom view (should succeed, leaving only the default view)
      await deleteView(table.id, view2Id);

      const finalViews = await getViews(table.id);
      expect(finalViews.length).toBe(1);
      expect(finalViews[0].name).toBe('Grid view'); // Only default view remains

      // Try to delete the last view (should fail)
      await expect(deleteView(table.id, finalViews[0].id)).rejects.toThrow(
        'Cannot delete the last view in a table'
      );
    });

    it('should handle concurrent deletion attempts with proper locking', async () => {
      // Create a scenario with exactly 2 views (default + view1)
      // Delete view2 first to have only 2 views
      await deleteView(table.id, view2Id);

      const remainingViews = await getViews(table.id);
      expect(remainingViews.length).toBe(2); // default view + view1

      // Attempt to delete both views concurrently
      // One should succeed, one should fail because it would be the last view
      const deletePromises = remainingViews.map((view) =>
        deleteView(table.id, view.id).catch((error) => error)
      );

      const results = await Promise.all(deletePromises);

      // One should succeed (undefined or success), one should fail with error
      const successCount = results.filter((r) => !r || r.message === undefined).length;
      const failureCount = results.filter(
        (r) => r && r.message && r.message.includes('Cannot delete the last view')
      ).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify exactly one view remains
      const finalViews = await getViews(table.id);
      expect(finalViews.length).toBe(1);
    });

    it('should use SELECT FOR UPDATE to prevent race conditions', async () => {
      // This test verifies that the locking mechanism works correctly
      // by attempting rapid concurrent deletions
      const view3 = await createView(table.id, {
        name: 'View 3',
        type: ViewType.Grid,
      });

      // Now we have 4 views: default, view1, view2, view3
      const allViews = await getViews(table.id);
      expect(allViews.length).toBe(4);

      // Delete 3 views concurrently, leaving only 1
      const viewsToDelete = [view1Id, view2Id, view3.id];
      const deleteResults = await Promise.allSettled(
        viewsToDelete.map((viewId) => deleteView(table.id, viewId))
      );

      // All 3 deletions should succeed
      const successfulDeletions = deleteResults.filter((r) => r.status === 'fulfilled').length;
      expect(successfulDeletions).toBe(3);

      // Verify only the default view remains
      const finalViews = await getViews(table.id);
      expect(finalViews.length).toBe(1);
      expect(finalViews[0].name).toBe('Grid view');
    });
  });
});
