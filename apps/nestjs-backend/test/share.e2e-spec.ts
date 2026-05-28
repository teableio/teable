import { type INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFilterRo,
  ILinkFieldOptions,
  IRecord,
  IUserFieldOptions,
  IViewRo,
} from '@teable/core';
import {
  ANONYMOUS_USER_ID,
  FieldKeyType,
  FieldType,
  is,
  Relationship,
  SortFunc,
  ViewType,
} from '@teable/core';
import {
  urlBuilder,
  SHARE_VIEW_GET,
  SHARE_VIEW_FORM_SUBMIT,
  SHARE_VIEW_RECORDS,
  createRecords as apiCreateRecords,
  deleteRecords as apiDeleteRecords,
  enableShareView as apiEnableShareView,
  getShareViewLinkRecords as apiGetShareViewLinkRecords,
  getShareViewCollaborators as apiGetShareViewCollaborators,
  getShareViewRecords as apiGetShareViewRecords,
  getBaseCollaboratorList as apiGetBaseCollaboratorList,
  updateViewColumnMeta as apiUpdateViewColumnMeta,
  updateViewShareMeta as apiUpdateViewShareMeta,
  SHARE_VIEW_COPY,
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
  OPERATION_UNDO,
  PASTE_URL,
  SHARE_VIEW_COLLABORATORS,
  SHARE_VIEW_ID_HEADER,
  UPDATE_RECORD,
} from '@teable/openapi';
import type { ITableFullVo, ShareViewAuthVo, ShareViewGetVo } from '@teable/openapi';
import { map } from 'lodash';
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

describe('OpenAPI ShareController (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let shareId: string;
  let viewId: string;
  let baseId: string;
  const spaceId = globalThis.testConfig.spaceId;
  const userId = globalThis.testConfig.userId;
  const userName = globalThis.testConfig.userName;
  const userEmail = globalThis.testConfig.email;
  let fieldIds: string[] = [];
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
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
    await permanentDeleteBase(baseId);
    await permanentDeleteTable(baseId, tableId);
    await app.close();
  });

  describe('api/:shareId/view (GET)', async () => {
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
      expect(record.createdBy).toEqual(ANONYMOUS_USER_ID);
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
          allow: true,
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

  describe('share view allowEdit permission scope', () => {
    let editTable: ITableFullVo;
    let editShareId: string;
    let editViewId: string;
    let nameFieldId: string;
    let secretFieldId: string;
    let visibleRecordId: string;
    let filteredOutRecordId: string;

    beforeAll(async () => {
      editTable = await createTable(baseId, {
        name: 'share-edit-scope-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Secret', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'Visible', Secret: 'visible-secret' } },
          { fields: { Name: 'Hidden', Secret: 'hidden-secret' } },
        ],
      });
      editViewId = editTable.defaultViewId!;
      nameFieldId = editTable.fields[0].id;
      secretFieldId = editTable.fields[1].id;
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
        const result = await apiGetShareViewLinkRecords(fromViewShareId, {
          fieldId: linkFieldId,
        });
        const linkRecords = result.data;
        expect(linkRecords.map((record) => record.title)).toEqual(
          tableRecords.map((record) => record.fields[primaryFieldName])
        );
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
        expect(linkRecords.map((record) => record.title)).toEqual(
          tableRecords.slice(0, 2).map((record) => record.fields[primaryFieldName])
        );
      });
    });
  });

  describe('api/:shareId/view/collaborators (GET)', () => {
    let userTableRes: ITableFullVo;
    const userFieldName = 'normal user';
    const multipleUserFieldName = 'multiple user';
    let userFieldId: string;
    let multipleUserFieldId: string;
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
        expect(result.data).toEqual([]);
      });

      it('should return the value that exists and there will be no duplicates of the', async () => {
        const { data: createRes } = await apiCreateRecords(userTableRes.id, {
          records: [
            {
              fields: {
                [multipleUserFieldId]: [{ id: userId, title: userName }],
                [userFieldId]: { id: userId, title: userName },
              },
            },
            {
              fields: {
                [multipleUserFieldId]: [{ id: userId, title: userName }],
                [userFieldId]: { id: userId, title: userName },
              },
            },
          ],
          fieldKeyType: FieldKeyType.Id,
        });
        const result = await apiGetShareViewCollaborators(gridViewShareId, {
          fieldId: userFieldId,
        });
        const mulResult = await apiGetShareViewCollaborators(gridViewShareId, {
          fieldId: multipleUserFieldId,
        });
        expect(result.data).toEqual([
          { userId, userName, email: userEmail, avatar: expect.any(String) },
        ]);
        expect(mulResult.data).toEqual([
          { userId, userName, email: userEmail, avatar: expect.any(String) },
        ]);

        await apiDeleteRecords(
          userTableRes.id,
          createRes.records.map((record) => record.id)
        );
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
        await apiUpdateViewColumnMeta(userTableRes.id, formViewId, [
          {
            fieldId: userFieldId,
            columnMeta: { visible: false },
          },
        ]);
      });
    });
  });

  describe('api/:shareId/view/copy (PATCH)', () => {
    let gridViewId: string;
    let gridViewShareId: string;

    beforeEach(async () => {
      const result = await createView(tableId, gridViewRo);
      gridViewId = result.id;

      const shareResult = await apiEnableShareView({ tableId, viewId: gridViewId });
      await apiUpdateViewShareMeta(tableId, gridViewId, { allowCopy: true });
      gridViewShareId = shareResult.data.shareId;
    });

    it('should return 200', async () => {
      const result = await anonymousUser.get(
        urlBuilder(SHARE_VIEW_COPY, { shareId: gridViewShareId }),
        {
          params: {
            ranges: JSON.stringify([
              [0, 0],
              [1, 1],
            ]),
          },
        }
      );
      expect(result.status).toEqual(200);
    });

    it('share not allow copy', async () => {
      const result = await createView(tableId, gridViewRo);
      const gridViewId = result.id;

      const shareResult = await apiEnableShareView({ tableId, viewId: gridViewId });
      const gridViewShareId = shareResult.data.shareId;
      const error = await getError(() =>
        anonymousUser.get(urlBuilder(SHARE_VIEW_COPY, { shareId: gridViewShareId }), {
          params: {
            ranges: JSON.stringify([
              [0, 0],
              [1, 1],
            ]),
          },
        })
      );
      expect(error?.status).toEqual(403);
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
