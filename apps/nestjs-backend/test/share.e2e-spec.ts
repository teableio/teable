import { type INestApplication } from '@nestjs/common';
import type { IFieldRo, IRecord, IUserFieldOptions, IViewRo } from '@teable/core';
import { ANONYMOUS_USER_ID, FieldKeyType, FieldType, Relationship, ViewType } from '@teable/core';
import {
  urlBuilder,
  SHARE_VIEW_GET,
  SHARE_VIEW_FORM_SUBMIT,
  createRecords as apiCreateRecords,
  deleteRecords as apiDeleteRecords,
  enableShareView as apiEnableShareView,
  getShareViewLinkRecords as apiGetShareViewLinkRecords,
  getShareViewCollaborators as apiGetShareViewCollaborators,
  getBaseCollaboratorList as apiGetBaseCollaboratorList,
  updateViewColumnMeta as apiUpdateViewColumnMeta,
  updateViewShareMeta as apiUpdateViewShareMeta,
  SHARE_VIEW_COPY,
  SHARE_VIEW_AUTH,
  getShareView,
  createField,
  updateViewShareMeta,
  shareViewFormSubmit,
} from '@teable/openapi';
import type { ITableFullVo, ShareViewAuthVo, ShareViewGetVo } from '@teable/openapi';
import { map } from 'lodash';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createTable,
  createView,
  permanentDeleteTable,
  initApp,
  updateViewColumnMeta,
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
  const baseId = globalThis.testConfig.baseId;
  const userId = globalThis.testConfig.userId;
  const userName = globalThis.testConfig.userName;
  const userEmail = globalThis.testConfig.email;
  let fieldIds: string[] = [];
  let anonymousUser: ReturnType<typeof createAnonymousUserAxios>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    anonymousUser = createAnonymousUserAxios(appCtx.appUrl);

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
        expect(result.data).toEqual([{ userId, userName, email: userEmail, avatar: null }]);
        expect(mulResult.data).toEqual([{ userId, userName, email: userEmail, avatar: null }]);

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
        const baseCollaborators = await apiGetBaseCollaboratorList(baseId);
        expect(result.data.map((user) => user.userId)).toEqual(
          baseCollaborators.data.map((user) => user.userId)
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
      expect(
        user2Request.get(urlBuilder(SHARE_VIEW_GET, { shareId: shareResult.data.shareId }))
      ).rejects.toThrow();
    });
  });
});
