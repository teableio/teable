import { type INestApplication } from '@nestjs/common';
import type {
  IButtonFieldCellValue,
  IFieldRo,
  IFilterRo,
  ILinkFieldOptions,
  IRecord,
  IUserFieldOptions,
  IViewRo,
} from '@teable/core';
import {
  ANONYMOUS_USER_ID,
  Colors,
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  generateWorkflowId,
  is,
  Relationship,
  SortFunc,
  StatisticsFunc,
  TimeFormatting,
  ViewType,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  urlBuilder,
  SHARE_VIEW_GET,
  SHARE_VIEW_FORM_SUBMIT,
  SHARE_VIEW_RECORDS,
  SHARE_VIEW_CALENDAR_DAILY_COLLECTION,
  SHARE_VIEW_ROW_COUNT,
  createRecords as apiCreateRecords,
  deleteRecords as apiDeleteRecords,
  enableShareView as apiEnableShareView,
  getShareViewLinkRecords as apiGetShareViewLinkRecords,
  getShareViewCollaborators as apiGetShareViewCollaborators,
  getShareViewRecords as apiGetShareViewRecords,
  getShareViewCalendarDailyCollection as apiGetShareViewCalendarDailyCollection,
  getBaseCollaboratorList as apiGetBaseCollaboratorList,
  updateViewColumnMeta as apiUpdateViewColumnMeta,
  updateViewShareMeta as apiUpdateViewShareMeta,
  SHARE_VIEW_COPY,
  SHARE_VIEW_BUTTON_CLICK,
  SHARE_VIEW_AUTH,
  getShareView,
  createField,
  updateViewShareMeta,
  shareViewFormSubmit,
  deleteView,
  PrincipalType,
  createBase,
  getShareViewRowCount,
  axios,
  CREATE_RECORD,
  DELETE_RECORD_URL,
  GET_RECORDS_URL,
  GET_SHARE_VIEW_SEARCH_COUNT,
  GET_SHARE_VIEW_SEARCH_INDEX,
  OPERATION_UNDO,
  PASTE_URL,
  SHARE_VIEW_COLLABORATORS,
  SHARE_VIEW_ID_HEADER,
  UPDATE_RECORD,
  getShareViewSearchCount,
  getShareViewSearchIndex,
  getShareViewAggregations,
  getShareViewGroupPoints,
  GroupPointType,
  ShareViewLinkRecordsType,
} from '@teable/openapi';
import type {
  ICopyVo,
  IButtonClickVo,
  IGroupPoint,
  ITableFullVo,
  ShareViewAuthVo,
  ShareViewGetVo,
} from '@teable/openapi';
import { map } from 'lodash';
import { vi } from 'vitest';
import { CacheService } from '../src/cache/cache.service';
import type { ICacheStore } from '../src/cache/types';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { CollaboratorService } from '../src/features/collaborator/collaborator.service';
import { FieldService } from '../src/features/field/field.service';
import { RecordOpenApiService } from '../src/features/record/open-api/record-open-api.service';
import { RecordService } from '../src/features/record/record.service';
import { SelectionService } from '../src/features/selection/selection.service';
import { ShareService } from '../src/features/share/share.service';
import { x_20 } from './data-helpers/20x';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createTable,
  createView,
  permanentDeleteTable,
  initApp,
  updateViewColumnMeta,
  updateViewFilter,
  getField,
  deleteField,
  convertField,
  updateRecordByApi,
  permanentDeleteBase,
} from './utils/init-app';

const formViewRo: IViewRo = {
  name: 'Form view',
  description: 'the form view',
  type: ViewType.Form,
};

const gridViewRo: IViewRo = {
  name: 'Grid view',
  description: 'the grid view',
  type: ViewType.Grid,
};

const isGroupHeaderPoint = (
  point: IGroupPoint
): point is Extract<IGroupPoint, { type: GroupPointType.Header }> =>
  point.type === GroupPointType.Header;

const isGroupRowPoint = (
  point: IGroupPoint
): point is Extract<IGroupPoint, { type: GroupPointType.Row }> => point.type === GroupPointType.Row;

describe('OpenAPI ShareController (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let shareId: string;
  let viewId: string;
  let baseId: string;
  const spaceId = globalThis.testConfig.spaceId;
  const userId = globalThis.testConfig.userId;
  const userName = globalThis.testConfig.userName;
  let fieldIds: string[] = [];
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;
  let cacheService: CacheService<ICacheStore>;
  let fieldService: FieldService;
  let recordService: RecordService;
  let recordOpenApiService: RecordOpenApiService;
  let selectionService: SelectionService;
  let shareService: ShareService;
  let collaboratorService: CollaboratorService;
  let prismaService: PrismaService;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    // Every v2 attribution assertion in this file expects the env_force_v2_all
    // reason; pin the env for the suite regardless of the CI lane default.
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const appCtx = await initApp();
    app = appCtx.app;
    cacheService = app.get(CacheService);
    fieldService = app.get(FieldService);
    recordService = app.get(RecordService);
    recordOpenApiService = app.get(RecordOpenApiService);
    selectionService = app.get(SelectionService);
    shareService = app.get(ShareService);
    collaboratorService = app.get(CollaboratorService);
    prismaService = app.get(PrismaService);
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);
    baseId = await createBase({
      name: 'share-e2e',
      spaceId,
    }).then((res) => res.data.id);
    const table = await createTable(baseId, { name: 'table1' });

    tableId = table.id;
    viewId = table.defaultViewId!;

    const shareResult = await apiEnableShareView({ tableId, viewId });
    fieldIds = map(table.fields, 'id');
    // hidden last one field
    const field = table.fields[fieldIds.length - 1];
    await updateViewColumnMeta(tableId, viewId, [
      { fieldId: field.id, columnMeta: { hidden: true } },
    ]);
    shareId = shareResult.data.shareId;
  });

  afterAll(async () => {
    if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
    else process.env.FORCE_V2_ALL = previousForceV2All;
    await permanentDeleteBase(baseId);
    await permanentDeleteTable(baseId, tableId);
    await app.close();
  });

  describe('api/:shareId/view (GET)', async () => {
    it('uses only v2 Table/Field/Record reads once the feature is selected', async () => {
      const legacyShareSpy = vi
        .spyOn(shareService, 'getShareView')
        .mockRejectedValue(new Error('legacy ShareService metadata path must not be used'));
      const legacyFieldSpy = vi
        .spyOn(fieldService, 'getFieldsByQuery')
        .mockRejectedValue(new Error('legacy FieldService must not be used'));
      const legacyRecordSpy = vi
        .spyOn(recordService, 'getRecords')
        .mockRejectedValue(new Error('legacy RecordService must not be used'));

      try {
        const result = await anonymousUser.get<ShareViewGetVo>(
          urlBuilder(SHARE_VIEW_GET, { shareId })
        );

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedView');
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data.fields).toHaveLength(fieldIds.length - 1);
        expect(result.data.records.length).toBeGreaterThan(0);
        expect(legacyShareSpy).not.toHaveBeenCalled();
        expect(legacyFieldSpy).not.toHaveBeenCalled();
        expect(legacyRecordSpy).not.toHaveBeenCalled();
      } finally {
        legacyShareSpy.mockRestore();
        legacyFieldSpy.mockRestore();
        legacyRecordSpy.mockRestore();
      }
    });

    it('includes hidden fields only when the aggregate share metadata allows it', async () => {
      await apiUpdateViewShareMeta(tableId, viewId, { includeHiddenField: true });
      try {
        const result = await anonymousUser.get<ShareViewGetVo>(
          urlBuilder(SHARE_VIEW_GET, { shareId })
        );

        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedView');
        expect(result.data.fields).toHaveLength(fieldIds.length);
        for (const record of result.data.records) {
          expect(Object.keys(record.fields)).toHaveLength(fieldIds.length);
        }
      } finally {
        await apiUpdateViewShareMeta(tableId, viewId, { includeHiddenField: false });
      }
    });

    it('should return view', async () => {
      const result = await anonymousUser.get<ShareViewGetVo>(
        urlBuilder(SHARE_VIEW_GET, { shareId })
      );
      const shareViewData = result.data;
      // filter hidden field
      expect(shareViewData.fields.length).toEqual(fieldIds.length - 1);
      expect(shareViewData.viewId).toEqual(viewId);
    });

    it('records return [] in not includeRecords', async () => {
      const result = await createView(tableId, gridViewRo);
      const viewId = result.id;
      const shareResult = await apiEnableShareView({ tableId, viewId });
      await updateViewShareMeta(tableId, viewId, { includeRecords: false });
      const viewShareId = shareResult.data.shareId;
      const resultData = await anonymousUser.get<ShareViewGetVo>(
        urlBuilder(SHARE_VIEW_GET, { shareId: viewShareId })
      );
      expect(resultData.data.records).toEqual([]);
    });

    it('password in grid view', async () => {
      const result = await createView(tableId, gridViewRo);
      const gridViewId = result.id;
      const shareResult = await apiEnableShareView({ tableId, viewId: gridViewId });
      const gridViewShareId = shareResult.data.shareId;
      await apiUpdateViewShareMeta(tableId, gridViewId, { password: '123123123' });
      const error = await getError(() =>
        anonymousUser.get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId: gridViewShareId }))
      );
      expect(error?.status).toEqual(401);
    });

    it('password in grid view had auth', async () => {
      const result = await createView(tableId, gridViewRo);
      const gridViewId = result.id;
      const shareResult = await apiEnableShareView({ tableId, viewId: gridViewId });
      const gridViewShareId = shareResult.data.shareId;
      await apiUpdateViewShareMeta(tableId, gridViewId, { password: '123123123' });
      const res = await anonymousUser.post<ShareViewAuthVo>(
        urlBuilder(SHARE_VIEW_AUTH, { shareId: gridViewShareId }),
        {
          password: '123123123',
        }
      );
      expect(res.headers[X_TEABLE_V2_HEADER]).toBe('true');
      expect(res.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedView');
      expect(res.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
      const resultData = await anonymousUser.get<ShareViewGetVo>(
        urlBuilder(SHARE_VIEW_GET, { shareId: gridViewShareId }),
        {
          headers: {
            cookie: res.headers['set-cookie'],
          },
        }
      );
      expect(resultData.data.viewId).toEqual(gridViewId);
    });

    it('keeps password authentication and shared reads on v1 when canary is disabled', async () => {
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

      try {
        const result = await createView(tableId, gridViewRo);
        const legacyViewId = result.id;
        const shareResult = await apiEnableShareView({ tableId, viewId: legacyViewId });
        const legacyShareId = shareResult.data.shareId;
        await apiUpdateViewShareMeta(tableId, legacyViewId, { password: 'legacy-password' });

        const authResponse = await anonymousUser.post<ShareViewAuthVo>(
          urlBuilder(SHARE_VIEW_AUTH, { shareId: legacyShareId }),
          { password: 'legacy-password' }
        );

        expect(authResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
        expect(authResponse.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedView');
        expect(authResponse.headers[X_TEABLE_V2_REASON_HEADER]).toBe('disabled');

        const viewResponse = await anonymousUser.get<ShareViewGetVo>(
          urlBuilder(SHARE_VIEW_GET, { shareId: legacyShareId }),
          { headers: { cookie: authResponse.headers['set-cookie'] } }
        );
        expect(viewResponse.headers[X_TEABLE_V2_HEADER]).toBe('false');
        expect(viewResponse.data.viewId).toBe(legacyViewId);
      } finally {
        if (previousForceV2All == null) delete process.env.FORCE_V2_ALL;
        else process.env.FORCE_V2_ALL = previousForceV2All;
        if (previousCanary == null) delete process.env.ENABLE_CANARY_FEATURE;
        else process.env.ENABLE_CANARY_FEATURE = previousCanary;
        await prismaService.base.update({
          where: { id: baseId },
          data: { v2Enabled: previousBase.v2Enabled },
        });
      }
    });
  });

  describe('api/:shareId/view/form-submit (POST)', () => {
    let formViewId: string;
    let fromViewShareId: string;

    beforeEach(async () => {
      const result = await createView(tableId, formViewRo);
      formViewId = result.id;

      const shareResult = await apiEnableShareView({ tableId, viewId: formViewId });
      fromViewShareId = shareResult.data.shareId;
    });

    it('submit form view', async () => {
      const result = await anonymousUser.post(
        urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: fromViewShareId }),
        {
          fields: {},
        }
      );
      const record = result.data as IRecord;
      expect(record.id).toBeDefined();
      // V1 form-submit returns createdBy; V2 canary/new-base path returns { id, fields }.
      // When present, anonymous public share must still attribute to the anonymous user.
      if (record.createdBy != null) {
        expect(record.createdBy).toEqual(ANONYMOUS_USER_ID);
      }
    });

    it('submit exclude form view', async () => {
      const result = await createView(tableId, gridViewRo);
      const gridViewId = result.id;
      const shareResult = await apiEnableShareView({ tableId, viewId: gridViewId });
      const gridViewShareId = shareResult.data.shareId;
      const error = await getError(() =>
        anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: gridViewShareId }), {
          fields: {},
        })
      );
      expect(error?.status).toEqual(403);
    });

    it('submit include hidden field', async () => {
      const hiddenFieldId = fieldIds[fieldIds.length - 1];
      await updateViewColumnMeta(tableId, formViewId, [
        { fieldId: fieldIds[fieldIds.length - 1], columnMeta: { visible: false } },
      ]);
      const error = await getError(() =>
        anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: fromViewShareId }), {
          fields: {
            [hiddenFieldId]: null,
          },
        })
      );
      expect(error?.status).toEqual(403);
    });

    it('required login', async () => {
      await updateViewShareMeta(tableId, formViewId, {
        submit: {
          requireLogin: true,
        },
      });
      const error = await getError(() =>
        anonymousUser.post(urlBuilder(SHARE_VIEW_FORM_SUBMIT, { shareId: fromViewShareId }), {
          fields: {},
        })
      );
      expect(error?.status).toEqual(401);
      const res = await shareViewFormSubmit({
        shareId: fromViewShareId,
        fields: {},
      });
      expect(res.status).toEqual(201);
    });
  });

  describe('api/:shareId/view/records (GET)', () => {
    let recordsTableId: string;
    let recordsViewId: string;
    let recordsShareId: string;
    let primaryFieldId: string;
    const primaryFieldName = 'Name';

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'records-test-table',
        fields: [
          {
            name: primaryFieldName,
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { [primaryFieldName]: 'Record 1' } },
          { fields: { [primaryFieldName]: 'Record 2' } },
          { fields: { [primaryFieldName]: 'Record 3' } },
        ],
      });
      recordsTableId = table.id;
      recordsViewId = table.defaultViewId!;
      primaryFieldId = table.fields[0].id;

      const shareResult = await apiEnableShareView({
        tableId: recordsTableId,
        viewId: recordsViewId,
      });
      recordsShareId = shareResult.data.shareId;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, recordsTableId);
    });

    it('uses the v2 Field scope and Record query without legacy reads', async () => {
      const legacyFieldSpy = vi
        .spyOn(fieldService, 'getFieldsByQuery')
        .mockRejectedValue(new Error('legacy FieldService must not be used'));
      const legacyRecordSpy = vi
        .spyOn(recordService, 'getRecords')
        .mockRejectedValue(new Error('legacy RecordService must not be used'));

      try {
        const result = await apiGetShareViewRecords(recordsShareId, {
          take: 2,
          skip: 0,
        });

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewRecords');
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data.records).toHaveLength(2);
        expect(legacyFieldSpy).not.toHaveBeenCalled();
        expect(legacyRecordSpy).not.toHaveBeenCalled();
      } finally {
        legacyFieldSpy.mockRestore();
        legacyRecordSpy.mockRestore();
      }
    });

    it('should return records with pagination', async () => {
      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 2,
        skip: 0,
      });

      expect(result.data.records.length).toEqual(2);
    });

    it('should return records with skip', async () => {
      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 10,
        skip: 1,
      });

      expect(result.data.records.length).toEqual(2);
    });

    it('should return empty array when includeRecords is false', async () => {
      await apiUpdateViewShareMeta(recordsTableId, recordsViewId, { includeRecords: false });

      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 10,
      });

      expect(result.data.records).toEqual([]);

      // Restore includeRecords
      await apiUpdateViewShareMeta(recordsTableId, recordsViewId, { includeRecords: true });
    });

    it('should return records with projection', async () => {
      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 10,
      });

      expect(result.data.records.length).toEqual(3);
      expect(result.data.records[0].fields).toHaveProperty(primaryFieldId);
    });

    it('should return records with filter', async () => {
      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 10,
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: primaryFieldId,
              operator: is.value,
              value: 'Record 1',
            },
          ],
        },
      });

      expect(result.data.records.length).toEqual(1);
      expect(result.data.records[0].fields[primaryFieldId]).toEqual('Record 1');
    });

    it('should return records with orderBy', async () => {
      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 10,
        orderBy: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
      });

      expect(result.data.records.length).toEqual(3);
      expect(result.data.records[0].fields[primaryFieldId]).toEqual('Record 3');
      expect(result.data.records[1].fields[primaryFieldId]).toEqual('Record 2');
      expect(result.data.records[2].fields[primaryFieldId]).toEqual('Record 1');
    });

    it('should return records with groupBy', async () => {
      const result = await apiGetShareViewRecords(recordsShareId, {
        take: 10,
        groupBy: [{ fieldId: primaryFieldId, order: SortFunc.Desc }],
      });

      expect(result.data.records.length).toEqual(3);
      // groupBy with desc order should return records in descending order
      expect(result.data.records[0].fields[primaryFieldId]).toEqual('Record 3');
      expect(result.data.records[1].fields[primaryFieldId]).toEqual('Record 2');
      expect(result.data.records[2].fields[primaryFieldId]).toEqual('Record 1');
    });

    it('should not allow anonymous access without share auth when password protected', async () => {
      await apiUpdateViewShareMeta(recordsTableId, recordsViewId, { password: 'test123' });

      const error = await getError(() =>
        anonymousUser.get(urlBuilder(SHARE_VIEW_RECORDS, { shareId: recordsShareId }), {
          params: { take: 10 },
        })
      );

      expect(error?.status).toEqual(401);

      // Restore no password
      await apiUpdateViewShareMeta(recordsTableId, recordsViewId, { password: undefined });
    });
  });

  describe('api/:shareId/view/row-count (GET)', () => {
    let rowCountTableId: string;
    let rowCountViewId: string;
    let rowCountShareId: string;
    let nameFieldId: string;
    let checkboxFieldId: string;

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'row-count-test-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Done', type: FieldType.Checkbox },
        ],
        records: [
          { fields: { Name: 'Alpha', Done: true } },
          { fields: { Name: 'Beta', Done: false } },
          { fields: { Name: 'Gamma', Done: false } },
        ],
      });
      rowCountTableId = table.id;
      rowCountViewId = table.defaultViewId!;
      nameFieldId = table.fields[0].id;
      checkboxFieldId = table.fields[1].id;
      const shareResult = await apiEnableShareView({
        tableId: rowCountTableId,
        viewId: rowCountViewId,
      });
      rowCountShareId = shareResult.data.shareId;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, rowCountTableId);
    });

    it('uses the v2 Table/Record query without legacy aggregation or Field reads', async () => {
      const legacyRowCountSpy = vi
        .spyOn(shareService, 'getViewRowCount')
        .mockRejectedValue(new Error('legacy AggregationService path must not be used'));
      const legacyFieldSpy = vi
        .spyOn(fieldService, 'getFieldInstances')
        .mockRejectedValue(new Error('legacy FieldService filter metadata must not be used'));
      const legacyRecordSpy = vi
        .spyOn(recordService, 'getRecords')
        .mockRejectedValue(new Error('legacy RecordService must not be used'));

      try {
        const result = await anonymousUser.get(
          urlBuilder(SHARE_VIEW_ROW_COUNT, { shareId: rowCountShareId })
        );

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewRowCount');
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data).toEqual({ rowCount: 3 });
        expect(legacyRowCountSpy).not.toHaveBeenCalled();
        expect(legacyFieldSpy).not.toHaveBeenCalled();
        expect(legacyRecordSpy).not.toHaveBeenCalled();
      } finally {
        legacyRowCountSpy.mockRestore();
        legacyFieldSpy.mockRestore();
        legacyRecordSpy.mockRestore();
      }
    });

    it('combines the aggregate View filter with a request filter', async () => {
      await updateViewFilter(rowCountTableId, rowCountViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: nameFieldId, operator: 'contains', value: 'a' }],
        },
      });
      try {
        const result = await getShareViewRowCount(rowCountShareId, {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: nameFieldId, operator: is.value, value: 'Beta' }],
          },
        });

        expect(result.data.rowCount).toBe(1);
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewRowCount');
      } finally {
        await updateViewFilter(rowCountTableId, rowCountViewId, { filter: null });
      }
    });

    it('normalizes the legacy unchecked-checkbox null filter through v2 Field metadata', async () => {
      const result = await getShareViewRowCount(rowCountShareId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: checkboxFieldId, operator: is.value, value: null }],
        },
      });

      expect(result.data.rowCount).toBe(2);
    });

    it('counts only records matching visible-row search', async () => {
      const result = await getShareViewRowCount(rowCountShareId, {
        search: ['Alpha', nameFieldId, true],
      });

      expect(result.data.rowCount).toBe(1);
    });

    it('returns zero before querying records when sharing disables records', async () => {
      await apiUpdateViewShareMeta(rowCountTableId, rowCountViewId, {
        includeRecords: false,
      });
      try {
        const result = await getShareViewRowCount(rowCountShareId, {});

        expect(result.data).toEqual({ rowCount: 0 });
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewRowCount');
      } finally {
        await apiUpdateViewShareMeta(rowCountTableId, rowCountViewId, {
          includeRecords: true,
        });
      }
    });

    it('rejects simultaneous link candidate and selected query modes', async () => {
      const error = await getError(() =>
        getShareViewRowCount(rowCountShareId, {
          filterLinkCellCandidate: nameFieldId,
          filterLinkCellSelected: nameFieldId,
        })
      );

      expect(error?.status).toBe(400);
    });

    it('preserves password protection before executing the v2 query', async () => {
      await apiUpdateViewShareMeta(rowCountTableId, rowCountViewId, {
        password: 'row-count-password',
      });
      try {
        const error = await getError(() =>
          anonymousUser.get(urlBuilder(SHARE_VIEW_ROW_COUNT, { shareId: rowCountShareId }))
        );

        expect(error?.status).toBe(401);
      } finally {
        await apiUpdateViewShareMeta(rowCountTableId, rowCountViewId, {
          password: undefined,
        });
      }
    });
  });

  describe('api/:shareId/view/aggregations (GET)', () => {
    const defaultAggregationShareMeta = { includeRecords: true };
    let aggregationTableId: string;
    let aggregationViewId: string;
    let aggregationShareId: string;
    let nameFieldId: string;
    let amountFieldId: string;
    let doneFieldId: string;
    let secretFieldId: string;
    let dueFieldId: string;

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'shared-aggregation-v2',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
          { name: 'Done', type: FieldType.Checkbox },
          { name: 'Secret', type: FieldType.Number },
          { name: 'Due', type: FieldType.Date },
        ],
        records: [
          {
            fields: {
              Name: 'A',
              Amount: 10,
              Done: true,
              Secret: 100,
              Due: '2025-01-01T00:00:00.000Z',
            },
          },
          {
            fields: {
              Name: 'A',
              Amount: 20,
              Done: false,
              Secret: 200,
              Due: '2025-02-15T00:00:00.000Z',
            },
          },
          {
            fields: {
              Name: 'B',
              Amount: 30,
              Done: false,
              Secret: 300,
              Due: '2025-03-01T00:00:00.000Z',
            },
          },
        ],
      });
      aggregationTableId = table.id;
      aggregationViewId = table.defaultViewId!;
      [nameFieldId, amountFieldId, doneFieldId, secretFieldId, dueFieldId] = table.fields.map(
        (field) => field.id
      );
      await updateViewColumnMeta(aggregationTableId, aggregationViewId, [
        { fieldId: amountFieldId, columnMeta: { statisticFunc: StatisticsFunc.Sum } },
        {
          fieldId: secretFieldId,
          columnMeta: { hidden: true, statisticFunc: StatisticsFunc.Sum },
        },
      ]);
      const shareResult = await apiEnableShareView({
        tableId: aggregationTableId,
        viewId: aggregationViewId,
      });
      aggregationShareId = shareResult.data.shareId;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, aggregationTableId);
    });

    it('uses the pure v2 Table/Record chain and returns totals plus grouped prefixes', async () => {
      const legacyAggregationSpy = vi
        .spyOn(shareService, 'getViewAggregations')
        .mockRejectedValue(new Error('legacy AggregationService path must not be used'));
      const legacyFieldSpy = vi
        .spyOn(fieldService, 'getFieldInstances')
        .mockRejectedValue(new Error('legacy FieldService must not be used'));
      const legacyRecordSpy = vi
        .spyOn(recordService, 'getRecords')
        .mockRejectedValue(new Error('legacy RecordService must not be used'));

      try {
        const result = await getShareViewAggregations(aggregationShareId, {
          field: {
            [StatisticsFunc.Count]: [nameFieldId],
            [StatisticsFunc.Sum]: [amountFieldId],
            [StatisticsFunc.Checked]: [doneFieldId],
          },
          groupBy: [{ fieldId: nameFieldId, order: SortFunc.Asc }],
        });

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewAggregations');
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data.aggregations?.map(({ fieldId, total }) => ({ fieldId, total }))).toEqual(
          [
            { fieldId: nameFieldId, total: { value: 3, aggFunc: StatisticsFunc.Count } },
            { fieldId: amountFieldId, total: { value: 60, aggFunc: StatisticsFunc.Sum } },
            { fieldId: doneFieldId, total: { value: 1, aggFunc: StatisticsFunc.Checked } },
          ]
        );
        expect(
          result.data.aggregations?.map(({ group }) =>
            Object.values(group ?? {})
              .map(({ value }) => value)
              .sort((left, right) => Number(left) - Number(right))
          )
        ).toEqual([
          [1, 2],
          [30, 30],
          [0, 1],
        ]);
        expect(legacyAggregationSpy).not.toHaveBeenCalled();
        expect(legacyFieldSpy).not.toHaveBeenCalled();
        expect(legacyRecordSpy).not.toHaveBeenCalled();
      } finally {
        legacyAggregationSpy.mockRestore();
        legacyFieldSpy.mockRestore();
        legacyRecordSpy.mockRestore();
      }
    });

    it('merges the aggregate View filter with the request filter', async () => {
      await updateViewFilter(aggregationTableId, aggregationViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: nameFieldId, operator: is.value, value: 'A' }],
        },
      });
      try {
        const result = await getShareViewAggregations(aggregationShareId, {
          field: { [StatisticsFunc.Sum]: [amountFieldId] },
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: amountFieldId, operator: is.value, value: 20 }],
          },
        });

        expect(result.data.aggregations).toEqual([
          {
            fieldId: amountFieldId,
            total: { value: 20, aggFunc: StatisticsFunc.Sum },
          },
        ]);
      } finally {
        await updateViewFilter(aggregationTableId, aggregationViewId, { filter: null });
      }
    });

    it('applies visible-row search before aggregation', async () => {
      const result = await getShareViewAggregations(aggregationShareId, {
        field: { [StatisticsFunc.Count]: [nameFieldId] },
        search: ['A', nameFieldId, true],
      });

      expect(result.data.aggregations).toEqual([
        {
          fieldId: nameFieldId,
          total: { value: 2, aggFunc: StatisticsFunc.Count },
        },
      ]);
    });

    it('covers empty, filled, unique, average, percentage, and date-range functions', async () => {
      const result = await getShareViewAggregations(aggregationShareId, {
        field: {
          [StatisticsFunc.Empty]: [amountFieldId],
          [StatisticsFunc.Filled]: [amountFieldId],
          [StatisticsFunc.Unique]: [nameFieldId],
          [StatisticsFunc.Average]: [amountFieldId],
          [StatisticsFunc.PercentFilled]: [amountFieldId],
          [StatisticsFunc.EarliestDate]: [dueFieldId],
          [StatisticsFunc.LatestDate]: [dueFieldId],
          [StatisticsFunc.DateRangeOfDays]: [dueFieldId],
          [StatisticsFunc.DateRangeOfMonths]: [dueFieldId],
        },
      });

      expect(result.data.aggregations).toEqual([
        { fieldId: amountFieldId, total: { value: 0, aggFunc: StatisticsFunc.Empty } },
        { fieldId: amountFieldId, total: { value: 3, aggFunc: StatisticsFunc.Filled } },
        { fieldId: nameFieldId, total: { value: 2, aggFunc: StatisticsFunc.Unique } },
        { fieldId: amountFieldId, total: { value: 20, aggFunc: StatisticsFunc.Average } },
        {
          fieldId: amountFieldId,
          total: { value: 100, aggFunc: StatisticsFunc.PercentFilled },
        },
        {
          fieldId: dueFieldId,
          total: { value: '2025-01-01T00:00:00.000Z', aggFunc: StatisticsFunc.EarliestDate },
        },
        {
          fieldId: dueFieldId,
          total: { value: '2025-03-01T00:00:00.000Z', aggFunc: StatisticsFunc.LatestDate },
        },
        {
          fieldId: dueFieldId,
          total: { value: 59, aggFunc: StatisticsFunc.DateRangeOfDays },
        },
        {
          fieldId: dueFieldId,
          total: { value: 2, aggFunc: StatisticsFunc.DateRangeOfMonths },
        },
      ]);
    });

    it('uses visible View column statistics by default and skips hidden statistics', async () => {
      const result = await getShareViewAggregations(aggregationShareId);

      expect(result.data.aggregations).toEqual([
        {
          fieldId: amountFieldId,
          total: { value: 60, aggFunc: StatisticsFunc.Sum },
        },
      ]);
    });

    it('allows hidden statistics only when share metadata explicitly includes hidden fields', async () => {
      const hiddenError = await getError(() =>
        getShareViewAggregations(aggregationShareId, {
          field: { [StatisticsFunc.Sum]: [secretFieldId] },
        })
      );
      expect(hiddenError?.status).toBe(403);

      await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
        ...defaultAggregationShareMeta,
        includeHiddenField: true,
      });
      try {
        const result = await getShareViewAggregations(aggregationShareId, {
          field: { [StatisticsFunc.Sum]: [secretFieldId] },
        });
        expect(result.data.aggregations).toEqual([
          {
            fieldId: secretFieldId,
            total: { value: 600, aggFunc: StatisticsFunc.Sum },
          },
        ]);
      } finally {
        await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
          ...defaultAggregationShareMeta,
        });
      }
    });

    it('returns no aggregations when shared records are disabled', async () => {
      await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
        ...defaultAggregationShareMeta,
        includeRecords: false,
      });
      try {
        const result = await getShareViewAggregations(aggregationShareId, {
          field: { [StatisticsFunc.Sum]: [amountFieldId] },
        });
        expect(result.data).toEqual({ aggregations: [] });
      } finally {
        await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
          ...defaultAggregationShareMeta,
        });
      }
    });

    it('rejects a statistic function that is invalid for the Field child', async () => {
      const error = await getError(() =>
        getShareViewAggregations(aggregationShareId, {
          field: { [StatisticsFunc.Sum]: [nameFieldId] },
        })
      );

      expect(error?.status).toBe(400);
    });

    it('preserves password authorization before the v2 aggregate query', async () => {
      await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
        ...defaultAggregationShareMeta,
        password: 'aggregation-password',
      });
      try {
        const error = await getError(() =>
          getShareViewAggregations(aggregationShareId, {
            field: { [StatisticsFunc.Count]: [nameFieldId] },
          })
        );
        expect(error?.status).toBe(401);
      } finally {
        await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
          ...defaultAggregationShareMeta,
        });
      }
    });

    describe('api/:shareId/view/group-points (GET)', () => {
      it('uses only the v2 Table/Record chain and preserves multi-level group order', async () => {
        const legacyGroupSpy = vi
          .spyOn(shareService, 'getViewGroupPoints')
          .mockRejectedValue(new Error('legacy group-points path must not be used'));
        const legacyFieldSpy = vi
          .spyOn(fieldService, 'getFieldInstances')
          .mockRejectedValue(new Error('legacy FieldService must not be used'));
        const legacyRecordSpy = vi
          .spyOn(recordService, 'getGroupRelatedData')
          .mockRejectedValue(new Error('legacy RecordService must not be used'));

        try {
          const result = await getShareViewGroupPoints(aggregationShareId, {
            groupBy: [
              { fieldId: nameFieldId, order: SortFunc.Asc },
              { fieldId: amountFieldId, order: SortFunc.Desc },
            ],
          });

          expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
          expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewGroupPoints');
          expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
          expect(
            result.data?.filter(isGroupHeaderPoint).map(({ depth, value }) => ({ depth, value }))
          ).toEqual([
            { depth: 0, value: 'A' },
            { depth: 1, value: 20 },
            { depth: 1, value: 10 },
            { depth: 0, value: 'B' },
            { depth: 1, value: 30 },
          ]);
          expect(result.data?.filter(isGroupRowPoint).map(({ count }) => count)).toEqual([1, 1, 1]);
          expect(legacyGroupSpy).not.toHaveBeenCalled();
          expect(legacyFieldSpy).not.toHaveBeenCalled();
          expect(legacyRecordSpy).not.toHaveBeenCalled();
        } finally {
          legacyGroupSpy.mockRestore();
          legacyFieldSpy.mockRestore();
          legacyRecordSpy.mockRestore();
        }
      });

      it('merges View/request filters, applies search, and honors collapsed group ids', async () => {
        await updateViewFilter(aggregationTableId, aggregationViewId, {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: amountFieldId, operator: is.value, value: 20 }],
          },
        });
        try {
          const initial = await getShareViewGroupPoints(aggregationShareId, {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: nameFieldId, operator: is.value, value: 'A' }],
            },
            search: ['A', nameFieldId, true],
            groupBy: [{ fieldId: nameFieldId, order: SortFunc.Asc }],
          });
          const header = initial.data?.find(
            (point) => point.type === GroupPointType.Header && point.value === 'A'
          );
          expect(header).toBeDefined();
          if (!header || header.type !== GroupPointType.Header) {
            throw new Error('Expected group header');
          }
          expect(initial.data?.filter((point) => point.type === GroupPointType.Row)).toEqual([
            { type: GroupPointType.Row, count: 1 },
          ]);

          const collapsed = await getShareViewGroupPoints(aggregationShareId, {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: nameFieldId, operator: is.value, value: 'A' }],
            },
            search: ['A', nameFieldId, true],
            groupBy: [{ fieldId: nameFieldId, order: SortFunc.Asc }],
            collapsedGroupIds: [header.id],
          });
          expect(collapsed.data).toEqual([{ ...header, isCollapsed: true }]);
        } finally {
          await updateViewFilter(aggregationTableId, aggregationViewId, { filter: null });
        }
      });

      it('protects hidden group Fields unless share metadata exposes them', async () => {
        const hiddenError = await getError(() =>
          getShareViewGroupPoints(aggregationShareId, {
            groupBy: [{ fieldId: secretFieldId, order: SortFunc.Asc }],
          })
        );
        expect(hiddenError?.status).toBe(403);

        await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
          ...defaultAggregationShareMeta,
          includeHiddenField: true,
        });
        try {
          const result = await getShareViewGroupPoints(aggregationShareId, {
            groupBy: [{ fieldId: secretFieldId, order: SortFunc.Desc }],
          });
          expect(result.data?.filter(isGroupHeaderPoint).map(({ value }) => value)).toEqual([
            300, 200, 100,
          ]);
        } finally {
          await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
            ...defaultAggregationShareMeta,
          });
        }
      });

      it('returns early for disabled records and absent grouping', async () => {
        const ungrouped = await getShareViewGroupPoints(aggregationShareId);
        expect(ungrouped.data).toEqual([]);

        await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
          ...defaultAggregationShareMeta,
          includeRecords: false,
        });
        try {
          const disabled = await getShareViewGroupPoints(aggregationShareId, {
            groupBy: [{ fieldId: nameFieldId, order: SortFunc.Asc }],
          });
          expect(disabled.data).toEqual([]);
        } finally {
          await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
            ...defaultAggregationShareMeta,
          });
        }
      });

      it('preserves password authorization before the v2 group query', async () => {
        await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
          ...defaultAggregationShareMeta,
          password: 'group-password',
        });
        try {
          const error = await getError(() =>
            getShareViewGroupPoints(aggregationShareId, {
              groupBy: [{ fieldId: nameFieldId, order: SortFunc.Asc }],
            })
          );
          expect(error?.status).toBe(401);
        } finally {
          await apiUpdateViewShareMeta(aggregationTableId, aggregationViewId, {
            ...defaultAggregationShareMeta,
          });
        }
      });
    });
  });

  describe('api/:shareId/view/search-count (GET)', () => {
    let searchTableId: string;
    let searchViewId: string;
    let searchShareId: string;
    let searchFieldId: string;

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'search-count-test-table',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [
          { fields: { Name: 'Alpha' } },
          { fields: { Name: 'Alpine' } },
          { fields: { Name: 'Beta' } },
        ],
      });
      searchTableId = table.id;
      searchViewId = table.defaultViewId!;
      searchFieldId = table.fields[0].id;
      await updateViewFilter(searchTableId, searchViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: searchFieldId, operator: is.value, value: 'Alpha' }],
        },
      });
      const shareResult = await apiEnableShareView({
        tableId: searchTableId,
        viewId: searchViewId,
      });
      searchShareId = shareResult.data.shareId;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, searchTableId);
    });

    it('uses only the v2 aggregate and Record query for filtered search counts', async () => {
      const legacySearchSpy = vi
        .spyOn(shareService, 'getShareSearchCount')
        .mockRejectedValue(new Error('legacy search-count path must not be used'));
      const legacyFieldSpy = vi
        .spyOn(fieldService, 'getFieldInstances')
        .mockRejectedValue(new Error('legacy FieldService must not be used'));
      const legacyRecordSpy = vi
        .spyOn(recordService, 'getRecords')
        .mockRejectedValue(new Error('legacy RecordService must not be used'));

      try {
        const result = await anonymousUser.get(
          urlBuilder(GET_SHARE_VIEW_SEARCH_COUNT, { shareId: searchShareId }),
          {
            params: {
              search: ['Alpha', searchFieldId, false],
              filter: JSON.stringify({
                conjunction: 'and',
                filterSet: [{ fieldId: searchFieldId, operator: 'contains', value: 'Al' }],
              }),
            },
          }
        );

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewSearchCount');
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data).toEqual({ count: 1 });
        expect(legacySearchSpy).not.toHaveBeenCalled();
        expect(legacyFieldSpy).not.toHaveBeenCalled();
        expect(legacyRecordSpy).not.toHaveBeenCalled();
      } finally {
        legacySearchSpy.mockRestore();
        legacyFieldSpy.mockRestore();
        legacyRecordSpy.mockRestore();
      }
    });

    it('cannot use caller viewId or ignoreViewQuery to escape the shared View', async () => {
      const result = await getShareViewSearchCount(searchShareId, {
        viewId: `viw${'x'.repeat(16)}`,
        ignoreViewQuery: true,
        search: ['Al', searchFieldId, false],
      });

      expect(result.data.count).toBe(1);
    });

    it('returns zero when no visible record matches the search', async () => {
      const result = await getShareViewSearchCount(searchShareId, {
        search: ['No match', searchFieldId, false],
      });

      expect(result.data).toEqual({ count: 0 });
    });

    it('returns zero before querying when sharing disables records', async () => {
      await apiUpdateViewShareMeta(searchTableId, searchViewId, {
        includeRecords: false,
      });
      try {
        const result = await getShareViewSearchCount(searchShareId, {
          search: ['Alpha', searchFieldId, false],
        });

        expect(result.data).toEqual({ count: 0 });
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewSearchCount');
      } finally {
        await apiUpdateViewShareMeta(searchTableId, searchViewId, {
          includeRecords: true,
        });
      }
    });

    it('rejects a missing search tuple before persistence', async () => {
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(GET_SHARE_VIEW_SEARCH_COUNT, { shareId: searchShareId }))
      );

      expect(error?.status).toBe(400);
    });
  });

  describe('api/:shareId/view/search-index (GET)', () => {
    let searchTableId: string;
    let searchViewId: string;
    let searchShareId: string;
    let nameFieldId: string;
    let notesFieldId: string;

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'search-index-test-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Notes', type: FieldType.SingleLineText },
          { name: 'Active', type: FieldType.Checkbox },
        ],
        records: [
          { fields: { Name: 'Alpha', Notes: 'first', Active: true } },
          { fields: { Name: 'Beta', Notes: 'second', Active: true } },
          { fields: { Name: 'Gamma', Notes: 'Alpha note', Active: true } },
          { fields: { Name: 'Hidden Alpha', Notes: 'excluded', Active: false } },
        ],
      });
      searchTableId = table.id;
      searchViewId = table.defaultViewId!;
      nameFieldId = table.fields.find((field) => field.name === 'Name')!.id;
      notesFieldId = table.fields.find((field) => field.name === 'Notes')!.id;
      const activeFieldId = table.fields.find((field) => field.name === 'Active')!.id;
      await updateViewFilter(searchTableId, searchViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: activeFieldId, operator: is.value, value: true }],
        },
      });
      const shareResult = await apiEnableShareView({
        tableId: searchTableId,
        viewId: searchViewId,
      });
      searchShareId = shareResult.data.shareId;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, searchTableId);
    });

    it('uses the v2 aggregate and Record repository without the legacy aggregation path', async () => {
      const legacySearchSpy = vi
        .spyOn(shareService, 'getShareSearchIndex')
        .mockRejectedValue(new Error('legacy search-index path must not be used'));
      try {
        const result = await getShareViewSearchIndex(searchShareId, {
          take: 10,
          search: ['Alpha', '', false],
        });

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewSearchIndex');
        expect(result.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ index: 1, fieldId: nameFieldId }),
            expect.objectContaining({ index: 3, fieldId: notesFieldId }),
          ])
        );
        expect(legacySearchSpy).not.toHaveBeenCalled();
      } finally {
        legacySearchSpy.mockRestore();
      }
    });

    it('numbers hidden-non-match results inside the matching result set', async () => {
      const result = await getShareViewSearchIndex(searchShareId, {
        skip: 1,
        take: 1,
        search: ['Alpha', '', true],
      });

      expect(result.data).toEqual([expect.objectContaining({ index: 2, fieldId: notesFieldId })]);
    });

    it('keeps the complete View row number when non-matching rows remain visible', async () => {
      const result = await getShareViewSearchIndex(searchShareId, {
        skip: 1,
        take: 1,
        search: ['Alpha', '', false],
      });

      expect(result.data).toEqual([expect.objectContaining({ index: 3, fieldId: notesFieldId })]);
    });

    it('honors projection and cannot escape the authorized shared View', async () => {
      const result = await getShareViewSearchIndex(searchShareId, {
        take: 10,
        projection: [nameFieldId],
        viewId: `viw${'x'.repeat(16)}`,
        ignoreViewQuery: true,
        search: ['Alpha', '', false],
      });

      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]).toEqual(expect.objectContaining({ index: 1, fieldId: nameFieldId }));
    });

    it('returns null before querying when sharing disables records', async () => {
      await apiUpdateViewShareMeta(searchTableId, searchViewId, { includeRecords: false });
      try {
        const result = await getShareViewSearchIndex(searchShareId, {
          take: 10,
          search: ['Alpha', '', false],
        });

        // Nest serializes a controller-level null response as an empty HTTP body.
        expect(result.data).toBe('');
      } finally {
        await apiUpdateViewShareMeta(searchTableId, searchViewId, { includeRecords: true });
      }
    });

    it('rejects missing search and result windows above 1000', async () => {
      const missingSearch = await getError(() =>
        anonymousUser.get(urlBuilder(GET_SHARE_VIEW_SEARCH_INDEX, { shareId: searchShareId }), {
          params: { take: 10 },
        })
      );
      const excessiveTake = await getError(() =>
        getShareViewSearchIndex(searchShareId, {
          take: 1001,
          search: ['Alpha', '', false],
        })
      );

      expect(missingSearch?.status).toBe(400);
      expect(excessiveTake?.status).toBe(400);
    });
  });

  // A share view's hidden columns must never reach a visitor, regardless of what
  // field references the client puts in the query. The per-endpoint default
  // projection only protects the default case; a crafted projection (records) or
  // the full-record calendar payload bypass it because the share context carries
  // no authority matrix to restrict columns server side.
  describe('api/:shareId/view hidden field read protection', () => {
    let leakTableId: string;
    let leakViewId: string;
    let leakShareId: string;
    let nameFieldId: string;
    let dueFieldId: string;
    let hiddenDueFieldId: string;
    let secretFieldId: string;
    const secretValue = 'top-secret-value';

    beforeAll(async () => {
      const table = await createTable(baseId, {
        name: 'hidden-read-leak',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Due',
            type: FieldType.Date,
            options: {
              formatting: {
                date: DateFormattingPreset.ISO,
                time: TimeFormatting.None,
                timeZone: 'Asia/Singapore',
              },
            },
          },
          {
            name: 'Hidden Due',
            type: FieldType.Date,
            options: {
              formatting: {
                date: DateFormattingPreset.ISO,
                time: TimeFormatting.None,
                timeZone: 'Asia/Singapore',
              },
            },
          },
          { name: 'Secret', type: FieldType.SingleLineText },
        ],
        records: [
          {
            fields: {
              Name: 'Visible',
              Due: '2022-03-01T10:00:00.000Z',
              ['Hidden Due']: '2022-03-01T10:00:00.000Z',
              Secret: secretValue,
            },
          },
          {
            fields: {
              Name: 'Other',
              Due: '2022-03-01T11:00:00.000Z',
              ['Hidden Due']: '2022-03-01T11:00:00.000Z',
              Secret: 'another-secret',
            },
          },
        ],
      });
      leakTableId = table.id;
      leakViewId = table.defaultViewId!;
      nameFieldId = table.fields[0].id;
      dueFieldId = table.fields[1].id;
      hiddenDueFieldId = table.fields[2].id;
      secretFieldId = table.fields[3].id;

      const shareResult = await apiEnableShareView({ tableId: leakTableId, viewId: leakViewId });
      leakShareId = shareResult.data.shareId;

      // hide the Secret column from the shared view
      await updateViewColumnMeta(leakTableId, leakViewId, [
        { fieldId: hiddenDueFieldId, columnMeta: { hidden: true } },
        { fieldId: secretFieldId, columnMeta: { hidden: true } },
      ]);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, leakTableId);
    });

    it('omits the hidden column from the records payload by default', async () => {
      const result = await apiGetShareViewRecords(leakShareId, { take: 10 });

      expect(result.data.records).toHaveLength(2);
      expect(result.data.records[0].fields).not.toHaveProperty(secretFieldId);
    });

    it('must not return a hidden column even when the client requests it via projection', async () => {
      const result = await apiGetShareViewRecords(leakShareId, {
        take: 10,
        projection: [secretFieldId],
      });

      const leaked = result.data.records.some(
        (record) => record.fields[secretFieldId] === secretValue
      );
      expect(leaked).toBe(false);
    });

    it('must not return hidden columns in the calendar daily collection records', async () => {
      const legacyCalendarSpy = vi.spyOn(shareService, 'getViewCalendarDailyCollection');
      const legacyFieldSpy = vi.spyOn(recordService, 'getFieldsByProjection');
      const legacyRecordSpy = vi.spyOn(recordService, 'getRecordsById');
      try {
        const result = await apiGetShareViewCalendarDailyCollection(leakShareId, {
          startDateFieldId: dueFieldId,
          endDateFieldId: dueFieldId,
          startDate: '2022-02-27T16:00:00.000Z',
          endDate: '2022-03-12T16:00:00.000Z',
        });

        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe(
          'getSharedViewCalendarDailyCollection'
        );
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data.countMap).toEqual(Object.fromEntries([['2022-03-01', 2]]));
        expect(result.data.records).toHaveLength(2);
        for (const record of result.data.records) {
          expect(record.fields).not.toHaveProperty(secretFieldId);
          expect(record.fields).not.toHaveProperty(hiddenDueFieldId);
        }
        expect(legacyCalendarSpy).not.toHaveBeenCalled();
        expect(legacyFieldSpy).not.toHaveBeenCalled();
        expect(legacyRecordSpy).not.toHaveBeenCalled();
      } finally {
        legacyCalendarSpy.mockRestore();
        legacyFieldSpy.mockRestore();
        legacyRecordSpy.mockRestore();
      }
    });

    it('ANDs the request filter and applies only visible-row search', async () => {
      const filtered = await apiGetShareViewCalendarDailyCollection(leakShareId, {
        startDateFieldId: dueFieldId,
        endDateFieldId: dueFieldId,
        startDate: '2022-02-27T16:00:00.000Z',
        endDate: '2022-03-12T16:00:00.000Z',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: nameFieldId, operator: is.value, value: 'Visible' }],
        },
      });
      expect(filtered.data.countMap).toEqual(Object.fromEntries([['2022-03-01', 1]]));
      expect(filtered.data.records).toHaveLength(1);
      expect(filtered.data.records[0].fields[nameFieldId]).toBe('Visible');

      const highlightOnly = await apiGetShareViewCalendarDailyCollection(leakShareId, {
        startDateFieldId: dueFieldId,
        endDateFieldId: dueFieldId,
        startDate: '2022-02-27T16:00:00.000Z',
        endDate: '2022-03-12T16:00:00.000Z',
        search: ['Visible', nameFieldId, false],
      });
      expect(highlightOnly.data.countMap).toEqual(Object.fromEntries([['2022-03-01', 2]]));

      const visibleRows = await apiGetShareViewCalendarDailyCollection(leakShareId, {
        startDateFieldId: dueFieldId,
        endDateFieldId: dueFieldId,
        startDate: '2022-02-27T16:00:00.000Z',
        endDate: '2022-03-12T16:00:00.000Z',
        search: ['Visible', nameFieldId, true],
      });
      expect(visibleRows.data.countMap).toEqual(Object.fromEntries([['2022-03-01', 1]]));
      expect(visibleRows.data.records).toHaveLength(1);
    });

    it('rejects hidden or invalid date fields and allows hidden dates only through share metadata', async () => {
      const hiddenError = await getError(() =>
        apiGetShareViewCalendarDailyCollection(leakShareId, {
          startDateFieldId: hiddenDueFieldId,
          endDateFieldId: hiddenDueFieldId,
          startDate: '2022-02-27T16:00:00.000Z',
          endDate: '2022-03-12T16:00:00.000Z',
        })
      );
      expect(hiddenError?.status).toBe(403);

      const invalidError = await getError(() =>
        apiGetShareViewCalendarDailyCollection(leakShareId, {
          startDateFieldId: nameFieldId,
          endDateFieldId: nameFieldId,
          startDate: '2022-02-27T16:00:00.000Z',
          endDate: '2022-03-12T16:00:00.000Z',
        })
      );
      expect(invalidError?.status).toBe(400);

      await apiUpdateViewShareMeta(leakTableId, leakViewId, {
        includeRecords: true,
        includeHiddenField: true,
      });
      try {
        const included = await apiGetShareViewCalendarDailyCollection(leakShareId, {
          startDateFieldId: hiddenDueFieldId,
          endDateFieldId: hiddenDueFieldId,
          startDate: '2022-02-27T16:00:00.000Z',
          endDate: '2022-03-12T16:00:00.000Z',
        });
        expect(included.data.countMap).toEqual(Object.fromEntries([['2022-03-01', 2]]));
        expect(included.data.records[0].fields).toHaveProperty(hiddenDueFieldId);
      } finally {
        await apiUpdateViewShareMeta(leakTableId, leakViewId, {
          includeRecords: true,
          includeHiddenField: false,
        });
      }
    });

    it('returns an empty collection before querying records when share metadata disables them', async () => {
      await apiUpdateViewShareMeta(leakTableId, leakViewId, {
        includeRecords: false,
        includeHiddenField: false,
      });
      try {
        const result = await apiGetShareViewCalendarDailyCollection(leakShareId, {
          startDateFieldId: dueFieldId,
          endDateFieldId: dueFieldId,
          startDate: '2022-02-27T16:00:00.000Z',
          endDate: '2022-03-12T16:00:00.000Z',
        });
        expect(result.data).toEqual({ countMap: {}, records: [] });
      } finally {
        await apiUpdateViewShareMeta(leakTableId, leakViewId, {
          includeRecords: true,
          includeHiddenField: false,
        });
      }
    });

    it('preserves password authorization before the v2 calendar query', async () => {
      await apiUpdateViewShareMeta(leakTableId, leakViewId, {
        includeRecords: true,
        includeHiddenField: false,
        password: 'calendar-secret',
      });
      try {
        const error = await getError(() =>
          anonymousUser.get(
            urlBuilder(SHARE_VIEW_CALENDAR_DAILY_COLLECTION, {
              shareId: leakShareId,
            }),
            {
              params: {
                startDateFieldId: dueFieldId,
                endDateFieldId: dueFieldId,
                startDate: '2022-02-27T16:00:00.000Z',
                endDate: '2022-03-12T16:00:00.000Z',
              },
            }
          )
        );
        expect(error?.status).toBe(401);
      } finally {
        await apiUpdateViewShareMeta(leakTableId, leakViewId, {
          includeRecords: true,
          includeHiddenField: false,
        });
      }
    });
  });

  describe('share view allowEdit permission scope', () => {
    let editTable: ITableFullVo;
    let editShareId: string;
    let editViewId: string;
    let nameFieldId: string;
    let secretFieldId: string;
    let assigneeFieldId: string;
    let visibleRecordId: string;
    let filteredOutRecordId: string;

    beforeAll(async () => {
      editTable = await createTable(baseId, {
        name: 'share-edit-scope-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Secret', type: FieldType.SingleLineText },
          {
            name: 'Assignee',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          },
        ],
        records: [
          { fields: { Name: 'Visible', Secret: 'visible-secret' } },
          { fields: { Name: 'Hidden', Secret: 'hidden-secret' } },
        ],
      });
      editViewId = editTable.defaultViewId!;
      nameFieldId = editTable.fields[0].id;
      secretFieldId = editTable.fields[1].id;
      assigneeFieldId = editTable.fields[2].id;
      visibleRecordId = editTable.records[0].id;
      filteredOutRecordId = editTable.records[1].id;

      await updateViewFilter(editTable.id, editViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: nameFieldId,
              operator: is.value,
              value: 'Visible',
            },
          ],
        },
      });
      await apiUpdateViewColumnMeta(editTable.id, editViewId, [
        { fieldId: secretFieldId, columnMeta: { hidden: true } },
      ]);
      const shareResult = await apiEnableShareView({ tableId: editTable.id, viewId: editViewId });
      editShareId = shareResult.data.shareId;
      await apiUpdateViewShareMeta(editTable.id, editViewId, {
        allowEdit: true,
        includeRecords: true,
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, editTable.id);
    });

    it('should allow logged-in share editors to update visible fields on visible records', async () => {
      const result = await axios.patch<IRecord>(
        urlBuilder(UPDATE_RECORD, { tableId: editTable.id, recordId: visibleRecordId }),
        {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [nameFieldId]: 'Visible',
            },
          },
        },
        { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
      );

      expect(result.data.fields[nameFieldId]).toEqual('Visible');
    });

    it('should deny share editors from updating hidden fields', async () => {
      const error = await getError(() =>
        axios.patch<IRecord>(
          urlBuilder(UPDATE_RECORD, { tableId: editTable.id, recordId: visibleRecordId }),
          {
            fieldKeyType: FieldKeyType.Id,
            record: {
              fields: {
                [secretFieldId]: 'leak',
              },
            },
          },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should deny share editors from updating records outside the shared view filter', async () => {
      const error = await getError(() =>
        axios.patch<IRecord>(
          urlBuilder(UPDATE_RECORD, { tableId: editTable.id, recordId: filteredOutRecordId }),
          {
            fieldKeyType: FieldKeyType.Id,
            record: {
              fields: {
                [nameFieldId]: 'Hidden edited',
              },
            },
          },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should deny share editors from creating hidden-field values', async () => {
      const error = await getError(() =>
        axios.post(
          urlBuilder(CREATE_RECORD, { tableId: editTable.id }),
          {
            fieldKeyType: FieldKeyType.Id,
            records: [
              {
                fields: {
                  [secretFieldId]: 'created secret',
                },
              },
            ],
          },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should reject common read endpoints with the share-view header', async () => {
      const error = await getError(() =>
        axios.post(
          urlBuilder(`${GET_RECORDS_URL}/socket/doc-ids`, { tableId: editTable.id }),
          { viewId: editViewId, take: 10 },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should keep anonymous allowEdit viewers on collaborator narrow mode', async () => {
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(SHARE_VIEW_COLLABORATORS, { shareId: editShareId }))
      );

      expect(error?.status).toEqual(400);
    });

    it('should give logged-in share editors the full collaborator directory', async () => {
      const result = await apiGetShareViewCollaborators(editShareId, {
        fieldId: assigneeFieldId,
      });

      expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewCollaborators');
      expect(result.data.map((item) => item.userId)).toContain(userId);
      expect(result.data.every((item) => !('email' in item))).toBe(true);
    });

    it('should allow share editors to delete a visible record', async () => {
      // Use a fresh record so we don't disturb the rest of the suite.
      const created = await apiCreateRecords(editTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [nameFieldId]: 'Visible' } }],
      });
      const tempRecordId = created.data.records[0].id;

      const result = await axios.delete(
        urlBuilder(DELETE_RECORD_URL, { tableId: editTable.id, recordId: tempRecordId }),
        { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
      );

      expect(result.status).toEqual(200);
    });

    it('should deny share editors from deleting out-of-scope records', async () => {
      const error = await getError(() =>
        axios.delete(
          urlBuilder(DELETE_RECORD_URL, { tableId: editTable.id, recordId: filteredOutRecordId }),
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should deny selection paste declaring a hidden field in projection', async () => {
      const error = await getError(() =>
        axios.patch(
          urlBuilder(PASTE_URL, { tableId: editTable.id }),
          {
            viewId: editViewId,
            ranges: [
              [0, 0],
              [0, 0],
            ],
            projection: [secretFieldId],
            content: 'leaked',
          },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should accept selection paste with visible projection on visible rows', async () => {
      // Confirms the strict assertSelectionQuery requirements (viewId match,
      // no ignoreViewQuery, no filter override, non-empty visible projection)
      // do not break the normal frontend payload shape.
      const result = await axios.patch(
        urlBuilder(PASTE_URL, { tableId: editTable.id }),
        {
          viewId: editViewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
          projection: [nameFieldId],
          content: 'Pasted',
        },
        { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
      );

      expect(result.status).toEqual(200);
    });

    it('should deny anonymous writes carrying the share-view header', async () => {
      const error = await getError(() =>
        anonymousUser.patch(
          urlBuilder(UPDATE_RECORD, { tableId: editTable.id, recordId: visibleRecordId }),
          {
            fieldKeyType: FieldKeyType.Id,
            record: { fields: { [nameFieldId]: 'anonymous attempt' } },
          },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should deny writes when allowEdit is turned off', async () => {
      await apiUpdateViewShareMeta(editTable.id, editViewId, {
        allowEdit: false,
        includeRecords: true,
      });
      try {
        const error = await getError(() =>
          axios.patch(
            urlBuilder(UPDATE_RECORD, { tableId: editTable.id, recordId: visibleRecordId }),
            {
              fieldKeyType: FieldKeyType.Id,
              record: { fields: { [nameFieldId]: 'edit off' } },
            },
            { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
          )
        );

        expect(error?.status).toEqual(403);
      } finally {
        await apiUpdateViewShareMeta(editTable.id, editViewId, {
          allowEdit: true,
          includeRecords: true,
        });
      }
    });

    it('should deny writes when includeRecords is off even with allowEdit on', async () => {
      await apiUpdateViewShareMeta(editTable.id, editViewId, {
        allowEdit: true,
        includeRecords: false,
      });
      try {
        const error = await getError(() =>
          axios.patch(
            urlBuilder(UPDATE_RECORD, { tableId: editTable.id, recordId: visibleRecordId }),
            {
              fieldKeyType: FieldKeyType.Id,
              record: { fields: { [nameFieldId]: 'no records exposed' } },
            },
            { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
          )
        );

        expect(error?.status).toEqual(403);
      } finally {
        await apiUpdateViewShareMeta(editTable.id, editViewId, {
          allowEdit: true,
          includeRecords: true,
        });
      }
    });

    it('should deny share-view header targeting a different table than its owning view', async () => {
      // `tableId` is the suite-level table — different from editTable. Using
      // editShareId here simulates an attacker pointing a legitimate share at
      // unrelated tables in the same base.
      const error = await getError(() =>
        axios.post(
          urlBuilder(CREATE_RECORD, { tableId }),
          {
            fieldKeyType: FieldKeyType.Id,
            records: [{ fields: {} }],
          },
          { headers: { [SHARE_VIEW_ID_HEADER]: editShareId } }
        )
      );

      expect(error?.status).toEqual(403);
    });

    it('should accept undo-redo calls in share-view context', async () => {
      // PermissionGuard's share-view rule whitelists undo-redo so that share
      // editors can reverse their own ops. Asserting the endpoint is reachable
      // (not the undo semantics — empty stacks legally return 'empty').
      const result = await axios.post(
        urlBuilder(OPERATION_UNDO, { tableId: editTable.id }),
        {},
        {
          headers: {
            [SHARE_VIEW_ID_HEADER]: editShareId,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'x-window-id': 'share-edit-undo-test',
          },
        }
      );

      expect(result.status).toEqual(201);
      expect(['fulfilled', 'empty', 'failed']).toContain(result.data.status);
    });
  });

  describe('api/:shareId/view/link-records (GET)', () => {
    let linkTableRes: ITableFullVo;
    const primaryFieldName = 'Text1';
    let linkFieldId: string;
    let tableRes: ITableFullVo;

    const tableRecords = [
      { fields: { [primaryFieldName]: '1' } },
      { fields: { [primaryFieldName]: '2' } },
      { fields: { [primaryFieldName]: '3' } },
    ];

    beforeAll(async () => {
      tableRes = await createTable(baseId, {
        records: tableRecords,
        fields: [
          {
            name: primaryFieldName,
            type: FieldType.SingleLineText,
          },
        ],
      });
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: tableRes.id,
        },
      };

      linkTableRes = await createTable(baseId, {
        name: 'linkTable',
        fields: [
          {
            name: 'primary',
            type: FieldType.SingleLineText,
          },
          linkFieldRo,
        ],
        records: [
          { fields: { primary: '1', [linkFieldRo.name!]: { id: tableRes.records[0].id } } },
          { fields: { primary: '2', [linkFieldRo.name!]: { id: tableRes.records[1].id } } },
        ],
      });
      linkFieldId = linkTableRes.fields[1].id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, linkTableRes.id);
      await permanentDeleteTable(baseId, tableRes.id);
    });

    describe('form view', () => {
      let formViewId: string;
      let fromViewShareId: string;
      beforeAll(async () => {
        const result = await createView(linkTableRes.id, formViewRo);
        formViewId = result.id;
        await apiUpdateViewColumnMeta(linkTableRes.id, formViewId, [
          {
            fieldId: linkFieldId,
            columnMeta: { visible: true },
          },
        ]);
        const shareResult = await apiEnableShareView({
          tableId: linkTableRes.id,
          viewId: formViewId,
        });
        fromViewShareId = shareResult.data.shareId;
      });
      it('should return link records', async () => {
        const legacyShareSpy = vi
          .spyOn(shareService, 'getViewLinkRecords')
          .mockRejectedValue(new Error('legacy shared Link Records path must not be used'));
        const legacyFieldSpy = vi
          .spyOn(fieldService, 'getField')
          .mockRejectedValue(new Error('legacy FieldService must not be used'));
        const legacyRecordSpy = vi
          .spyOn(recordService, 'getRecords')
          .mockRejectedValue(new Error('legacy RecordService must not be used'));

        try {
          const result = await apiGetShareViewLinkRecords(fromViewShareId, {
            fieldId: linkFieldId,
          });
          const linkRecords = result.data;
          expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
          expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewLinkRecords');
          expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
          expect(linkRecords.map((record) => record.title)).toEqual(
            tableRecords.map((record) => record.fields[primaryFieldName])
          );
          expect(legacyShareSpy).not.toHaveBeenCalled();
          expect(legacyFieldSpy).not.toHaveBeenCalled();
          expect(legacyRecordSpy).not.toHaveBeenCalled();
        } finally {
          legacyShareSpy.mockRestore();
          legacyFieldSpy.mockRestore();
          legacyRecordSpy.mockRestore();
        }
      });

      it('applies lookup-only search and page windows while includeRecords is absent', async () => {
        const searched = await apiGetShareViewLinkRecords(fromViewShareId, {
          fieldId: linkFieldId,
          search: '2',
          take: 1,
          skip: 0,
        });
        const paged = await apiGetShareViewLinkRecords(fromViewShareId, {
          fieldId: linkFieldId,
          take: 1,
          skip: 1,
        });

        expect(searched.data.map((record) => record.title)).toEqual(['2']);
        expect(paged.data.map((record) => record.title)).toEqual(['2']);
      });
    });

    describe('grid view', () => {
      let gridViewId: string;
      let gridViewShareId: string;
      beforeAll(async () => {
        const result = await createView(linkTableRes.id, gridViewRo);
        gridViewId = result.id;
        const shareResult = await apiEnableShareView({
          tableId: linkTableRes.id,
          viewId: gridViewId,
        });
        gridViewShareId = shareResult.data.shareId;
      });

      it('should return link records', async () => {
        const result = await apiGetShareViewLinkRecords(gridViewShareId, {
          fieldId: linkFieldId,
        });
        const linkRecords = result.data;
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewLinkRecords');
        expect(linkRecords.map((record) => record.title)).toEqual(
          tableRecords.slice(0, 2).map((record) => record.fields[primaryFieldName])
        );
      });

      it('rejects hidden and non-Link Fields at the Table aggregate boundary', async () => {
        await apiUpdateViewColumnMeta(linkTableRes.id, gridViewId, [
          { fieldId: linkFieldId, columnMeta: { hidden: true } },
        ]);
        try {
          const hiddenError = await getError(() =>
            apiGetShareViewLinkRecords(gridViewShareId, { fieldId: linkFieldId })
          );
          const nonLinkError = await getError(() =>
            apiGetShareViewLinkRecords(gridViewShareId, {
              fieldId: linkTableRes.fields[0].id,
            })
          );

          expect(hiddenError?.status).toBe(403);
          expect(nonLinkError?.status).toBe(403);

          await apiUpdateViewShareMeta(linkTableRes.id, gridViewId, {
            includeHiddenField: true,
          });
          const allowed = await apiGetShareViewLinkRecords(gridViewShareId, {
            fieldId: linkFieldId,
          });
          expect(allowed.data.map((record) => record.title)).toEqual(['1', '2']);
        } finally {
          await apiUpdateViewShareMeta(linkTableRes.id, gridViewId, {
            includeHiddenField: false,
          });
          await apiUpdateViewColumnMeta(linkTableRes.id, gridViewId, [
            { fieldId: linkFieldId, columnMeta: { hidden: false } },
          ]);
        }
      });
    });

    describe('plugin view', () => {
      let pluginViewShareId: string;

      beforeAll(async () => {
        const pluginView = await createView(linkTableRes.id, {
          type: ViewType.Plugin,
          options: {
            pluginId: 'plgsheetform',
            pluginInstallId: 'ignored-by-create',
            pluginLogo: 'ignored-by-create',
          },
        });
        const shareResult = await apiEnableShareView({
          tableId: linkTableRes.id,
          viewId: pluginView.id,
        });
        pluginViewShareId = shareResult.data.shareId;
      });

      it('switches only Plugin Views between selected and candidate scopes', async () => {
        const selected = await apiGetShareViewLinkRecords(pluginViewShareId, {
          fieldId: linkFieldId,
          type: ShareViewLinkRecordsType.Selected,
        });
        const candidate = await apiGetShareViewLinkRecords(pluginViewShareId, {
          fieldId: linkFieldId,
          type: ShareViewLinkRecordsType.Candidate,
        });

        expect(selected.data.map((record) => record.title)).toEqual(['1', '2']);
        expect(candidate.data.map((record) => record.title)).toEqual(['1', '2', '3']);
      });
    });
  });

  describe('api/:shareId/view/collaborators (GET)', () => {
    let userTableRes: ITableFullVo;
    const userFieldName = 'normal user';
    const multipleUserFieldName = 'multiple user';
    let userFieldId: string;
    let multipleUserFieldId: string;
    let primaryFieldId: string;
    const userFieldRo: IFieldRo = {
      name: userFieldName,
      type: FieldType.User,
      options: {
        isMultiple: false,
        shouldNotify: false,
      } as IUserFieldOptions,
    };

    const multipleUserFieldRo: IFieldRo = {
      name: multipleUserFieldName,
      type: FieldType.User,
      options: {
        isMultiple: true,
        shouldNotify: false,
      } as IUserFieldOptions,
    };
    beforeAll(async () => {
      userTableRes = await createTable(baseId, {
        name: 'user table',
        fields: [
          {
            name: 'primary',
            type: FieldType.SingleLineText,
          },
          userFieldRo,
          multipleUserFieldRo,
        ],
        records: [],
      });
      userFieldId = userTableRes.fields[1].id;
      multipleUserFieldId = userTableRes.fields[2].id;
      primaryFieldId = userTableRes.fields[0].id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, userTableRes.id);
    });
    describe('grid view', () => {
      let gridViewId: string;
      let gridViewShareId: string;
      beforeAll(async () => {
        const result = await createView(userTableRes.id, gridViewRo);
        gridViewId = result.id;
        const shareResult = await apiEnableShareView({
          tableId: userTableRes.id,
          viewId: gridViewId,
        });
        gridViewShareId = shareResult.data.shareId;
      });
      it('should return [], no user cell with a value exists', async () => {
        const result = await apiGetShareViewCollaborators(gridViewShareId, {
          fieldId: userFieldId,
        });
        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewCollaborators');
        expect(result.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(result.data).toEqual([]);
      });

      it('should return the value that exists and there will be no duplicates of the', async () => {
        const legacyShareSpy = vi
          .spyOn(shareService, 'getViewCollaborators')
          .mockRejectedValue(new Error('legacy collaborator path must not be used'));
        const legacyFieldSpy = vi
          .spyOn(fieldService, 'getField')
          .mockRejectedValue(new Error('legacy FieldService must not be used'));
        const legacyRecordSpy = vi
          .spyOn(recordService, 'getDbTableName')
          .mockRejectedValue(new Error('legacy RecordService must not be used'));
        const legacyDirectorySpy = vi
          .spyOn(collaboratorService, 'getUserCollaborators')
          .mockRejectedValue(new Error('legacy CollaboratorService must not be used'));
        const { data: createRes } = await apiCreateRecords(userTableRes.id, {
          records: [
            {
              fields: {
                [primaryFieldId]: 'Visible',
                [multipleUserFieldId]: [{ id: userId, title: userName }],
                [userFieldId]: { id: userId, title: userName },
              },
            },
            {
              fields: {
                [primaryFieldId]: 'Hidden',
                [multipleUserFieldId]: [{ id: userId, title: userName }],
                [userFieldId]: { id: userId, title: userName },
              },
            },
          ],
          fieldKeyType: FieldKeyType.Id,
        });
        try {
          const result = await apiGetShareViewCollaborators(gridViewShareId, {
            fieldId: userFieldId,
          });
          const mulResult = await apiGetShareViewCollaborators(gridViewShareId, {
            fieldId: multipleUserFieldId,
          });
          // Email is intentionally omitted from share responses to avoid leaking
          // the member directory to anonymous viewers.
          expect(result.data).toEqual([{ userId, userName, avatar: expect.any(String) }]);
          expect(mulResult.data).toEqual([{ userId, userName, avatar: expect.any(String) }]);
          expect(result.data[0]).not.toHaveProperty('email');
          expect(legacyShareSpy).not.toHaveBeenCalled();
          expect(legacyFieldSpy).not.toHaveBeenCalled();
          expect(legacyRecordSpy).not.toHaveBeenCalled();
          expect(legacyDirectorySpy).not.toHaveBeenCalled();
        } finally {
          legacyShareSpy.mockRestore();
          legacyFieldSpy.mockRestore();
          legacyRecordSpy.mockRestore();
          legacyDirectorySpy.mockRestore();
          await apiDeleteRecords(
            userTableRes.id,
            createRes.records.map((record) => record.id)
          );
        }
      });

      it('applies the View filter before resolving referenced collaborators', async () => {
        const { data: created } = await apiCreateRecords(userTableRes.id, {
          records: [
            { fields: { [primaryFieldId]: 'Visible' } },
            {
              fields: {
                [primaryFieldId]: 'Hidden',
                [userFieldId]: { id: userId, title: userName },
              },
            },
          ],
          fieldKeyType: FieldKeyType.Id,
        });
        await updateViewFilter(userTableRes.id, gridViewId, {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: primaryFieldId, operator: is.value, value: 'Visible' }],
          },
        });
        try {
          const result = await apiGetShareViewCollaborators(gridViewShareId, {
            fieldId: userFieldId,
          });
          expect(result.data).toEqual([]);
        } finally {
          await updateViewFilter(userTableRes.id, gridViewId, { filter: null });
          await apiDeleteRecords(
            userTableRes.id,
            created.records.map((record) => record.id)
          );
        }
      });

      it('rejects missing, hidden, and non-user Fields at the Table boundary', async () => {
        const missing = await getError(() => apiGetShareViewCollaborators(gridViewShareId, {}));
        const nonUser = await getError(() =>
          apiGetShareViewCollaborators(gridViewShareId, { fieldId: primaryFieldId })
        );
        await apiUpdateViewColumnMeta(userTableRes.id, gridViewId, [
          { fieldId: userFieldId, columnMeta: { hidden: true } },
        ]);
        try {
          const hidden = await getError(() =>
            apiGetShareViewCollaborators(gridViewShareId, { fieldId: userFieldId })
          );
          expect(missing?.status).toBe(400);
          expect(nonUser?.status).toBe(403);
          expect(hidden?.status).toBe(403);
        } finally {
          await apiUpdateViewColumnMeta(userTableRes.id, gridViewId, [
            { fieldId: userFieldId, columnMeta: { hidden: false } },
          ]);
        }
      });
    });

    describe('Form view', () => {
      let formViewId: string;
      let fromViewShareId: string;
      beforeAll(async () => {
        const result = await createView(userTableRes.id, formViewRo);
        formViewId = result.id;
        const shareResult = await apiEnableShareView({
          tableId: userTableRes.id,
          viewId: formViewId,
        });
        fromViewShareId = shareResult.data.shareId;
      });
      it('should return [], no user cell visible', async () => {
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          {
            fieldId: userFieldId,
            columnMeta: { visible: false },
          },
        ]);
        const result = await apiGetShareViewCollaborators(fromViewShareId, {
          fieldId: userFieldId,
        });
        expect(result.data).toEqual([]);
      });
      it('should return the base collaborators', async () => {
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          {
            fieldId: userFieldId,
            columnMeta: { visible: true },
          },
        ]);
        const result = await apiGetShareViewCollaborators(fromViewShareId, {});
        const baseCollaborators = await apiGetBaseCollaboratorList(baseId, {
          type: PrincipalType.User,
        });
        expect(result.data.map((user) => user.userId)).toEqual(
          baseCollaborators.data.collaborators.map((item) => item.userId)
        );
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewCollaborators');
        expect(result.data.every((item) => !('email' in item))).toBe(true);
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          {
            fieldId: userFieldId,
            columnMeta: { visible: false },
          },
        ]);
      });
      it('should search collaborators by name but not by email', async () => {
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          { fieldId: userFieldId, columnMeta: { visible: true } },
        ]);
        const byName = await apiGetShareViewCollaborators(fromViewShareId, {
          search: userName,
        });
        expect(byName.data.map((user) => user.userId)).toContain(userId);
        // Email is neither returned nor searchable for anonymous shares, so a
        // full email must not surface a collaborator (membership oracle closed).
        const byEmail = await apiGetShareViewCollaborators(fromViewShareId, {
          search: globalThis.testConfig.email,
        });
        expect(byEmail.data).toEqual([]);
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          { fieldId: userFieldId, columnMeta: { visible: false } },
        ]);
      });

      it('applies directory pagination and preserves password authorization', async () => {
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          { fieldId: userFieldId, columnMeta: { visible: true } },
        ]);
        const first = await apiGetShareViewCollaborators(fromViewShareId, {
          take: 1,
          skip: 0,
        });
        const afterFirst = await apiGetShareViewCollaborators(fromViewShareId, {
          take: 1,
          skip: 100,
        });
        expect(first.data).toHaveLength(1);
        expect(afterFirst.data).toEqual([]);

        await apiUpdateViewShareMeta(userTableRes.id, formViewId, {
          password: 'collaborator-secret',
        });
        try {
          const error = await getError(() =>
            anonymousUser.get(urlBuilder(SHARE_VIEW_COLLABORATORS, { shareId: fromViewShareId }))
          );
          expect(error?.status).toBe(401);
        } finally {
          await apiUpdateViewShareMeta(userTableRes.id, formViewId, {});
          await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
            { fieldId: userFieldId, columnMeta: { visible: false } },
          ]);
        }
      });
    });

    describe('Plugin view', () => {
      let pluginShareId: string;

      beforeAll(async () => {
        const pluginView = await createView(userTableRes.id, {
          type: ViewType.Plugin,
          options: {
            pluginId: 'plgsheetform',
            pluginInstallId: 'ignored-by-create',
            pluginLogo: 'ignored-by-create',
          },
        });
        const shareResult = await apiEnableShareView({
          tableId: userTableRes.id,
          viewId: pluginView.id,
        });
        pluginShareId = shareResult.data.shareId;
      });

      it('uses the full member directory without a subtype fallback', async () => {
        const result = await apiGetShareViewCollaborators(pluginShareId, {
          fieldId: userFieldId,
        });

        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewCollaborators');
        expect(result.data.map((item) => item.userId)).toContain(userId);
      });
    });
  });

  describe('api/:shareId/view/record/:recordId/:fieldId/button-click (POST)', () => {
    let buttonTable: ITableFullVo;
    let buttonViewId: string;
    let buttonShareId: string;
    let buttonFieldId: string;
    let textFieldId: string;
    let recordId: string;

    const click = (fieldId = buttonFieldId) =>
      anonymousUser.post<IButtonClickVo>(
        urlBuilder(SHARE_VIEW_BUTTON_CLICK, {
          shareId: buttonShareId,
          recordId,
          fieldId,
        })
      );

    beforeAll(async () => {
      buttonTable = await createTable(baseId, {
        name: 'shared-button-click-v2',
        fields: x_20.fields,
        records: x_20.records.slice(0, 2),
      });
      buttonViewId = buttonTable.defaultViewId!;
      textFieldId = buttonTable.fields[0].id;
      recordId = buttonTable.records[0].id;
      const field = await createField(buttonTable.id, {
        type: FieldType.Button,
        options: {
          label: 'Run',
          color: Colors.Teal,
          workflow: {
            id: generateWorkflowId(),
            name: 'Run',
            isActive: true,
          },
        },
      });
      buttonFieldId = field.data.id;
      const shareResult = await apiEnableShareView({
        tableId: buttonTable.id,
        viewId: buttonViewId,
      });
      buttonShareId = shareResult.data.shareId;
      await apiUpdateViewShareMeta(buttonTable.id, buttonViewId, {
        includeRecords: true,
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, buttonTable.id);
    });

    it('increments through the isolated v2 chain and reports the feature', async () => {
      const legacySpy = vi
        .spyOn(recordOpenApiService, 'buttonClick')
        .mockRejectedValue(new Error('legacy RecordOpenApiService.buttonClick must not be used'));
      try {
        const first = await click();
        const second = await click();

        expect(first.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(first.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('buttonClick');
        expect((first.data.record.fields[buttonFieldId] as IButtonFieldCellValue).count).toBe(1);
        expect((second.data.record.fields[buttonFieldId] as IButtonFieldCellValue).count).toBe(2);
        expect(legacySpy).not.toHaveBeenCalled();
      } finally {
        legacySpy.mockRestore();
      }
    });

    it('rejects a non-Button Field at the Table aggregate boundary', async () => {
      const error = await getError(() => click(textFieldId));
      expect(error?.status).toBe(400);
    });

    it('rejects an inactive workflow', async () => {
      const inactive = await createField(buttonTable.id, {
        type: FieldType.Button,
        options: {
          label: 'Inactive',
          color: Colors.Teal,
          workflow: {
            id: generateWorkflowId(),
            name: 'Inactive',
            isActive: false,
          },
        },
      });

      const error = await getError(() => click(inactive.data.id));
      expect(error?.status).toBe(400);
    });

    it('enforces maxCount', async () => {
      const limited = await createField(buttonTable.id, {
        type: FieldType.Button,
        options: {
          label: 'Once',
          color: Colors.Teal,
          maxCount: 1,
          workflow: {
            id: generateWorkflowId(),
            name: 'Once',
            isActive: true,
          },
        },
      });

      await click(limited.data.id);
      const error = await getError(() => click(limited.data.id));
      expect(error?.status).toBe(400);
    });

    it('rejects a hidden Field unless share metadata includes hidden Fields', async () => {
      await apiUpdateViewColumnMeta(buttonTable.id, buttonViewId, [
        { fieldId: buttonFieldId, columnMeta: { hidden: true } },
      ]);
      try {
        const hiddenError = await getError(() => click());
        expect(hiddenError?.status).toBe(403);

        await apiUpdateViewShareMeta(buttonTable.id, buttonViewId, {
          includeRecords: true,
          includeHiddenField: true,
        });
        await expect(click()).resolves.toMatchObject({ status: 201 });
      } finally {
        await apiUpdateViewShareMeta(buttonTable.id, buttonViewId, {
          includeRecords: true,
          includeHiddenField: false,
        });
        await apiUpdateViewColumnMeta(buttonTable.id, buttonViewId, [
          { fieldId: buttonFieldId, columnMeta: { hidden: false } },
        ]);
      }
    });

    it('rejects a Record outside the shared View filter', async () => {
      await updateViewFilter(buttonTable.id, buttonViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: textFieldId, operator: is.value, value: 'not-present' }],
        },
      });
      try {
        const error = await getError(() => click());
        expect(error?.status).toBe(403);
      } finally {
        await updateViewFilter(buttonTable.id, buttonViewId, { filter: null });
      }
    });

    it('rejects clicks when shared records are disabled', async () => {
      await apiUpdateViewShareMeta(buttonTable.id, buttonViewId, {
        includeRecords: false,
      });
      try {
        const error = await getError(() => click());
        expect(error?.status).toBe(403);
      } finally {
        await apiUpdateViewShareMeta(buttonTable.id, buttonViewId, {
          includeRecords: true,
        });
      }
    });
  });

  describe('api/:shareId/view/copy (GET)', () => {
    let copyTable: ITableFullVo;
    let copyViewId: string;
    let copyShareId: string;
    let textFieldId: string;
    let numberFieldId: string;

    const getCopy = (params: Record<string, unknown>) =>
      anonymousUser.get<ICopyVo>(urlBuilder(SHARE_VIEW_COPY, { shareId: copyShareId }), {
        params,
      });

    beforeAll(async () => {
      copyTable = await createTable(baseId, {
        name: 'shared-copy-v2',
        fields: x_20.fields,
        records: x_20.records,
      });
      copyViewId = copyTable.defaultViewId!;
      textFieldId = copyTable.fields[0].id;
      numberFieldId = copyTable.fields[1].id;
      const shareResult = await apiEnableShareView({
        tableId: copyTable.id,
        viewId: copyViewId,
      });
      copyShareId = shareResult.data.shareId;
      await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
        allowCopy: true,
        includeRecords: true,
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, copyTable.id);
    });

    it('returns exact clipboard content/header through the isolated v2 chain', async () => {
      const legacyCopySpy = vi
        .spyOn(shareService, 'copy')
        .mockRejectedValue(new Error('legacy ShareService.copy must not be used'));
      const legacySelectionSpy = vi
        .spyOn(selectionService, 'copy')
        .mockRejectedValue(new Error('legacy SelectionService.copy must not be used'));
      try {
        const result = await getCopy({
          ranges: JSON.stringify([
            [0, 1],
            [1, 2],
          ]),
        });

        expect(result.status).toBe(200);
        expect(result.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(result.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getSharedViewCopy');
        expect(result.data.content).toBe('Text Field 0\t0.0\nText Field 1\t1.0');
        expect(result.data.header.map((field) => field.id)).toEqual([textFieldId, numberFieldId]);
        expect(legacyCopySpy).not.toHaveBeenCalled();
        expect(legacySelectionSpy).not.toHaveBeenCalled();
      } finally {
        legacyCopySpy.mockRestore();
        legacySelectionSpy.mockRestore();
      }
    });

    it('preserves disjoint row ranges and their request order', async () => {
      const result = await getCopy({
        type: 'rows',
        projection: [textFieldId],
        ranges: JSON.stringify([
          [2, 3],
          [1, 1],
        ]),
      });

      expect(result.data.content).toBe('Text Field 1\nText Field 2\nText Field 0');
      expect(result.data.header.map((field) => field.id)).toEqual([textFieldId]);
    });

    it('copies all matched rows for a column selection', async () => {
      const result = await getCopy({
        type: 'columns',
        ranges: JSON.stringify([[0, 0]]),
      });

      expect(result.data.header.map((field) => field.id)).toEqual([textFieldId]);
      expect(result.data.content.split('\n')).toHaveLength(x_20.records.length);
      expect(result.data.content).toContain('Text Field 0');
      expect(result.data.content).toContain('Text Field 20');
    });

    it('bounds projection to View visibility and honors includeHiddenField explicitly', async () => {
      await apiUpdateViewColumnMeta(copyTable.id, copyViewId, [
        { fieldId: numberFieldId, columnMeta: { hidden: true } },
      ]);
      try {
        const hidden = await getCopy({
          projection: [numberFieldId, textFieldId],
          ranges: JSON.stringify([
            [0, 1],
            [1, 1],
          ]),
        });
        expect(hidden.data.header.map((field) => field.id)).toEqual([textFieldId]);
        expect(hidden.data.content).toBe('Text Field 0');

        const hiddenFilterError = await getError(() =>
          getCopy({
            filter: JSON.stringify({
              conjunction: 'and',
              filterSet: [{ fieldId: numberFieldId, operator: is.value, value: 0 }],
            }),
            ranges: JSON.stringify([
              [0, 0],
              [0, 0],
            ]),
          })
        );
        expect(hiddenFilterError?.status).toBe(403);

        await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
          allowCopy: true,
          includeRecords: true,
          includeHiddenField: true,
        });
        const included = await getCopy({
          projection: [numberFieldId, textFieldId],
          ranges: JSON.stringify([
            [0, 1],
            [1, 1],
          ]),
        });
        expect(included.data.header.map((field) => field.id)).toEqual([numberFieldId, textFieldId]);
        expect(included.data.content).toBe('0.0\tText Field 0');
      } finally {
        await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
          allowCopy: true,
          includeRecords: true,
          includeHiddenField: false,
        });
        await apiUpdateViewColumnMeta(copyTable.id, copyViewId, [
          { fieldId: numberFieldId, columnMeta: { hidden: false } },
        ]);
      }
    });

    it('cannot replace the authorized View or bypass its filter', async () => {
      const otherView = await createView(copyTable.id, gridViewRo);
      await updateViewFilter(copyTable.id, copyViewId, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: textFieldId, operator: is.value, value: 'Text Field 3' }],
        },
      });
      try {
        const result = await getCopy({
          viewId: otherView.id,
          ignoreViewQuery: true,
          type: 'columns',
          ranges: JSON.stringify([[0, 0]]),
        });

        expect(result.data.content).toBe('Text Field 3');
      } finally {
        await updateViewFilter(copyTable.id, copyViewId, { filter: null });
        await deleteView(copyTable.id, otherView.id);
      }
    });

    it('excludes records inside collapsed groups through the Table Record repository', async () => {
      const groupBy = [{ fieldId: textFieldId, order: SortFunc.Asc }];
      const points = await getShareViewGroupPoints(copyShareId, { groupBy });
      const collapsed = points.data?.find(
        (point): point is Extract<IGroupPoint, { type: GroupPointType.Header }> =>
          isGroupHeaderPoint(point) && point.depth === 0 && point.value === 'Text Field 3'
      );
      expect(collapsed?.id).toBeDefined();

      const result = await getCopy({
        type: 'columns',
        ranges: JSON.stringify([[0, 0]]),
        groupBy: JSON.stringify(groupBy),
        collapsedGroupIds: JSON.stringify([collapsed!.id]),
      });
      const rows = result.data.content.split('\n');

      expect(rows).not.toContain('Text Field 3');
      expect(rows).toContain('Text Field 2');
      expect(rows).toContain('Text Field 4');

      const queryId = `qry_copy_${copyShareId}`;
      const cacheKey = `query-params:${queryId}` as const;
      await cacheService.setDetail(cacheKey, { collapsedGroupIds: [collapsed!.id] }, 60);
      try {
        const cachedResult = await getCopy({
          type: 'columns',
          ranges: JSON.stringify([[0, 0]]),
          groupBy: JSON.stringify(groupBy),
          queryId,
        });
        expect(cachedResult.data.content.split('\n')).not.toContain('Text Field 3');
      } finally {
        await cacheService.del(cacheKey);
      }
    });

    it('does not read records when share metadata excludes them', async () => {
      await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
        allowCopy: true,
        includeRecords: false,
      });
      try {
        const result = await getCopy({
          ranges: JSON.stringify([
            [0, 0],
            [0, 1],
          ]),
        });
        expect(result.data.content).toBe('');
        expect(result.data.header.map((field) => field.id)).toEqual([textFieldId]);
      } finally {
        await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
          allowCopy: true,
          includeRecords: true,
        });
      }
    });

    it.each([
      { ranges: 'not-json' },
      { ranges: JSON.stringify([[0, 0]]) },
      {
        ranges: JSON.stringify([
          [1, 1],
          [0, 0],
        ]),
      },
      { type: 'rows', ranges: JSON.stringify([[2, 1]]) },
    ])('rejects malformed ranges: $ranges', async (params) => {
      const error = await getError(() => getCopy(params));
      expect(error?.status).toBe(400);
    });

    it('rejects a share without allowCopy', async () => {
      await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
        allowCopy: false,
        includeRecords: true,
      });
      try {
        const error = await getError(() =>
          getCopy({
            ranges: JSON.stringify([
              [0, 0],
              [0, 0],
            ]),
          })
        );
        expect(error?.status).toBe(403);
      } finally {
        await apiUpdateViewShareMeta(copyTable.id, copyViewId, {
          allowCopy: true,
          includeRecords: true,
        });
      }
    });
  });

  describe('link view permission', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should get link view', async () => {
      const linkField = await createField(table1.id, {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });
      const shareResult = await getShareView(linkField.data.id);

      // should not allow access by other user
      const user2Request = await createNewUserAxios({
        email: 'newuser@example.com',
        password: '12345678',
      });
      await expect(
        user2Request.get(urlBuilder(SHARE_VIEW_GET, { shareId: shareResult.data.shareId }))
      ).rejects.toThrow();
    });

    it('resolves lookup-of-link share view to the inner link foreign table', async () => {
      const table3 = await createTable(baseId, {
        name: 'table3',
        fields: [{ name: 'Target Name', type: FieldType.SingleLineText }],
        records: [{ fields: { 'Target Name': 'Inner Target' } }],
      });
      try {
        const middleLink = await createField(table2.id, {
          name: 'middle to target',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: table3.id,
          },
        });
        const hostLink = await createField(table1.id, {
          name: 'host to middle',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: table2.id,
          },
        });
        const lookupOfLink = await createField(table1.id, {
          name: 'lookup of link',
          type: FieldType.Link,
          isLookup: true,
          lookupOptions: {
            foreignTableId: table2.id,
            linkFieldId: hostLink.data.id,
            lookupFieldId: middleLink.data.id,
          },
        });

        // Production lookup-of-link fields store foreignTableId only in
        // lookup_options; options is empty. Recreate that shape.
        await prismaService.field.update({
          where: { id: lookupOfLink.data.id },
          data: { options: null },
        });

        const shareResult = await getShareView(lookupOfLink.data.id);

        expect(shareResult.data.tableId).toBe(table3.id);
        expect(shareResult.data.shareId).toBe(lookupOfLink.data.id);
        expect(shareResult.data.fields.some((field) => field.isPrimary)).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, table3.id);
      }
    });

    it('returns cross-base link picker fields and records through the v2 share path', async () => {
      const foreignBase = (await createBase({ spaceId, name: 'cross-base-link-picker-target' }))
        .data;
      const sourceTable = await createTable(baseId, { name: 'cross-base-link-picker-source' });

      try {
        const categoryTable = await createTable(foreignBase.id, {
          name: 'cross-base-link-picker-categories',
          fields: [{ name: 'Category', type: FieldType.SingleLineText }],
          records: [{ fields: { Category: 'One' } }],
        });
        const categoryPrimary = categoryTable.fields.find((field) => field.isPrimary)!;
        const categoryRecordId = categoryTable.records[0].id;
        const foreignTable = await createTable(foreignBase.id, {
          name: 'cross-base-link-picker-records',
          fields: [
            { name: 'Code', type: FieldType.Number },
            { name: 'Name', type: FieldType.SingleLineText },
          ],
          records: [],
        });
        const primaryField = foreignTable.fields.find((field) => field.isPrimary)!;
        const nameField = foreignTable.fields.find((field) => field.name === 'Name')!;
        const categoryLink = await createField(foreignTable.id, {
          name: 'Category Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: categoryTable.id,
          },
        });
        const categoryLookup = await createField(foreignTable.id, {
          name: 'Category Name',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: categoryTable.id,
            linkFieldId: categoryLink.data.id,
            lookupFieldId: categoryPrimary.id,
          },
        });
        await apiCreateRecords(foreignTable.id, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              fields: {
                [primaryField.id]: 1,
                [nameField.id]: 'Alpha',
                [categoryLink.data.id]: { id: categoryRecordId },
              },
            },
          ],
        });
        await apiUpdateViewColumnMeta(foreignTable.id, foreignTable.defaultViewId!, [
          { fieldId: categoryLink.data.id, columnMeta: { hidden: true } },
        ]);
        const linkField = await createField(sourceTable.id, {
          name: 'cross-base link field',
          type: FieldType.Link,
          options: {
            baseId: foreignBase.id,
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
            filterByViewId: foreignTable.defaultViewId,
            visibleFieldIds: [
              primaryField.id,
              nameField.id,
              categoryLink.data.id,
              categoryLookup.data.id,
            ],
          },
        });

        const shareResult = await getShareView(linkField.data.id);

        expect(shareResult.data.fields.map((field) => field.id)).toEqual([
          primaryField.id,
          nameField.id,
          categoryLookup.data.id,
        ]);
        expect(shareResult.data.records).toHaveLength(1);
        expect(shareResult.data.records[0].fields).toMatchObject({
          [primaryField.id]: 1,
          [nameField.id]: 'Alpha',
          [categoryLookup.data.id]: 'One',
        });
      } finally {
        await permanentDeleteTable(baseId, sourceTable.id);
        await permanentDeleteBase(foreignBase.id);
      }
    });

    it('should not expose link view lookup for hidden fields through a share-view header', async () => {
      const linkField = await createField(table1.id, {
        name: 'hidden link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });
      await apiUpdateViewColumnMeta(table1.id, table1.defaultViewId!, [
        { fieldId: linkField.data.id, columnMeta: { hidden: true } },
      ]);
      const shareResult = await apiEnableShareView({
        tableId: table1.id,
        viewId: table1.defaultViewId!,
      });

      const error = await getError(() =>
        anonymousUser.get(urlBuilder(SHARE_VIEW_GET, { shareId: linkField.data.id }), {
          headers: { [SHARE_VIEW_ID_HEADER]: shareResult.data.shareId },
        })
      );

      expect(error?.status).toEqual(403);
    });

    it('search and filterLinkCellSelected', async () => {
      const linkField = await createField(table1.id, {
        name: 'link field1',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });
      const rowCountRes = await getShareViewRowCount(linkField.data.id, {
        search: ['1', table2.fields[0].id, true],
        filterLinkCellSelected: linkField.data.id,
      });
      expect(rowCountRes.data.rowCount).toEqual(0);
    });

    it('records endpoint honors search query', async () => {
      const primary = table2.fields[0];
      await apiCreateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [primary.id]: 'City College' } },
          { fields: { [primary.id]: 'Ewha Womans University' } },
        ],
      });
      const linkField = await createField(table1.id, {
        name: 'link field search',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });

      // global search across all visible fields should filter the candidate list
      const matched = await apiGetShareViewRecords(linkField.data.id, {
        search: ['City', '', true],
        filterLinkCellCandidate: linkField.data.id,
      });
      expect(matched.data.records).toHaveLength(1);
      expect(matched.data.records[0].fields[primary.id]).toEqual('City College');

      const unmatched = await apiGetShareViewRecords(linkField.data.id, {
        search: ['no-such-record', '', true],
        filterLinkCellCandidate: linkField.data.id,
      });
      expect(unmatched.data.records).toHaveLength(0);
    });

    // T4864: a record linked before (or outside of) the link field's filterByViewId
    // scope must still appear in the selected list / detail panel. The view scope only
    // limits which records can be newly linked (candidate list), not the existing links.
    it('selected list ignores the link field filterByViewId scope', async () => {
      const primary = table2.fields[0];

      const foreignRecords = await apiCreateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [primary.id]: 'in view' } },
          { fields: { [primary.id]: 'out of view' } },
        ],
      });
      const inViewId = foreignRecords.data.records[0].id;
      const outOfViewId = foreignRecords.data.records[1].id;

      // scope the foreign default view so only the "in view" record is visible
      await updateViewFilter(table2.id, table2.defaultViewId!, {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: primary.id, operator: is.value, value: 'in view' }],
        },
      });

      const linkField = await createField(table1.id, {
        name: 'scoped link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          filterByViewId: table2.defaultViewId,
        },
      });

      const hostRecords = await apiCreateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: {} }],
      });
      const hostId = hostRecords.data.records[0].id;

      // link the host record to the record that is NOT in the configured view
      await updateRecordByApi(table1.id, hostId, linkField.data.id, {
        id: outOfViewId,
      });

      const selectedQuery = {
        filterLinkCellSelected: [linkField.data.id, hostId] as [string, string],
      };

      // the already-linked record must be visible even though it fails the view filter
      const selected = await apiGetShareViewRecords(linkField.data.id, selectedQuery);
      expect(selected.data.records.map((r) => r.id)).toEqual([outOfViewId]);

      const selectedRowCount = await getShareViewRowCount(linkField.data.id, selectedQuery);
      expect(selectedRowCount.data.rowCount).toEqual(1);

      // the expand-record card loads already-linked records by selectedRecordIds and
      // must also bypass the view scope
      const byIds = await apiGetShareViewRecords(linkField.data.id, {
        selectedRecordIds: [outOfViewId],
      });
      expect(byIds.data.records.map((r) => r.id)).toEqual([outOfViewId]);

      // the candidate list must still respect the view filter
      const candidate = await apiGetShareViewRecords(linkField.data.id, {
        filterLinkCellCandidate: [linkField.data.id, hostId],
      });
      const candidateIds = candidate.data.records.map((r) => r.id);
      expect(candidateIds).toContain(inViewId);
      expect(candidateIds).not.toContain(outOfViewId);
    });
  });

  describe('link view limit', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, {
        name: 'table2',
        fields: x_20.fields,
        records: x_20.records,
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should get link view limit by view', async () => {
      const filterByViewId = table2.defaultViewId;
      const singleSelectField = table2.fields[2];
      const filter: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: singleSelectField.id,
              operator: is.value,
              value: 'x',
            },
          ],
        },
      };

      await updateViewFilter(table2.id, table2.defaultViewId!, filter);

      const linkField = await createField(table1.id, {
        name: 'link field limit by view',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          filterByViewId,
        },
      });
      const shareResult = await getShareView(linkField.data.id);

      expect(shareResult.data.records.length).toEqual(7);
    });

    it('should get link view limit by filter', async () => {
      const singleSelectField = table2.fields[2];
      const filter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: singleSelectField.id,
            operator: is.value,
            value: 'x',
          },
        ],
      };
      const linkField = await createField(table1.id, {
        name: 'link field limit by filter',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          filter,
        },
      });
      const shareResult = await getShareView(linkField.data.id);

      expect(shareResult.data.records.length).toEqual(7);
    });

    it('should get link view limit by visible fields', async () => {
      const fields = table2.fields;
      const visibleFieldIds = fields.slice(0, 3).map((field) => field.id);
      const linkField = await createField(table1.id, {
        name: 'link field limit by hidden fields',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          visibleFieldIds,
        },
      });
      const shareResult = await getShareView(linkField.data.id);

      expect(shareResult.data.fields.length).toEqual(3);
    });

    it('should keep the primary field visible when the API configuration omits it', async () => {
      const primaryField = table2.fields.find((field) => field.isPrimary);
      const configuredField = table2.fields.find((field) => !field.isPrimary);
      const unconfiguredField = table2.fields.find(
        (field) => field.id !== primaryField?.id && field.id !== configuredField?.id
      );
      if (!primaryField || !configuredField || !unconfiguredField) {
        throw new Error('Expected primary, configured, and unconfigured fields');
      }

      const linkField = await createField(table1.id, {
        name: 'link field with implicit primary visibility',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          visibleFieldIds: [configuredField.id],
        },
      });

      expect((linkField.data.options as ILinkFieldOptions).visibleFieldIds).toEqual([
        configuredField.id,
      ]);

      const shareResult = await getShareView(linkField.data.id);
      expect(shareResult.data.fields.map((field) => field.id)).toEqual([
        primaryField.id,
        configuredField.id,
      ]);

      const projectedRecords = await apiGetShareViewRecords(linkField.data.id, {
        projection: [configuredField.id],
      });
      const recordWithConfiguredValue = projectedRecords.data.records.find((record) =>
        Object.prototype.hasOwnProperty.call(record.fields, configuredField.id)
      );
      expect(recordWithConfiguredValue?.fields).toHaveProperty(primaryField.id);
      expect(recordWithConfiguredValue?.fields).toHaveProperty(configuredField.id);
      expect(recordWithConfiguredValue?.fields).not.toHaveProperty(unconfiguredField.id);
    });

    it('should get link view limited by multiple conditions', async () => {
      const filterByViewId = table2.defaultViewId;
      const textField = table2.fields[0];
      const singleSelectField = table2.fields[2];
      const filter: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: singleSelectField.id,
              operator: is.value,
              value: 'x',
            },
          ],
        },
      };

      await updateViewFilter(table2.id, table2.defaultViewId!, filter);

      const fields = table2.fields;
      const visibleFieldIds = fields.slice(0, 3).map((field) => field.id);

      const additionalFilter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: textField.id,
            operator: is.value,
            value: '6',
          },
        ],
      };

      const linkField = await createField(table1.id, {
        name: 'link field with multiple limits',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          filterByViewId,
          filter: additionalFilter,
          visibleFieldIds,
        },
      });
      const shareResult = await getShareView(linkField.data.id);

      expect(shareResult.data.records.length).toBeLessThanOrEqual(1);
      expect(shareResult.data.fields.length).toEqual(3);
    });

    it('should clean link options after filterByViewId is deleted', async () => {
      const view = await createView(table2.id, {
        name: 'view',
        type: ViewType.Grid,
      });

      const linkField = await createField(table1.id, {
        name: 'clean link options filterByViewId',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          filterByViewId: view.id,
        },
      });

      expect((linkField.data.options as ILinkFieldOptions).filterByViewId).toEqual(view.id);

      await deleteView(table2.id, view.id);
      const currentLinkField = await getField(table1.id, linkField.data.id);

      expect((currentLinkField.options as ILinkFieldOptions).filterByViewId).toBeNull();
    });

    it('should clean link options after filtering field is deleted', async () => {
      const singleSelectField = table2.fields[2];
      const filter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: singleSelectField.id,
            operator: is.value,
            value: 'x',
          },
        ],
      };

      const linkField = await createField(table1.id, {
        name: 'clean link options filter',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          filter,
          visibleFieldIds: [singleSelectField.id],
        },
      });

      expect((linkField.data.options as ILinkFieldOptions).filter).toEqual(filter);
      expect((linkField.data.options as ILinkFieldOptions).visibleFieldIds).toEqual([
        singleSelectField.id,
      ]);

      await deleteField(table2.id, singleSelectField.id);
      const currentLinkField = await getField(table1.id, linkField.data.id);

      expect((currentLinkField.options as ILinkFieldOptions).filter).toBeNull();
      expect((currentLinkField.options as ILinkFieldOptions).visibleFieldIds).toBeNull();
    });

    it('should clean link options after filtering field is converted', async () => {
      const singleSelectField = table2.fields[2];
      const filter = {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: singleSelectField.id,
            operator: is.value,
            value: 'x',
          },
        ],
      };

      const linkField = await createField(table1.id, {
        name: 'convert link options filter',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          filter,
        },
      });

      expect((linkField.data.options as ILinkFieldOptions).filter).toEqual(filter);

      await convertField(table2.id, singleSelectField.id, {
        type: FieldType.MultipleSelect,
      });
      const currentLinkField = await getField(table1.id, linkField.data.id);

      expect((currentLinkField.options as ILinkFieldOptions).filter).toBeNull();
    });
  });
});
