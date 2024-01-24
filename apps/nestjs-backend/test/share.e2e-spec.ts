import { type INestApplication } from '@nestjs/common';
import type { IFieldRo, IRecord, ITableFullVo, IViewRo } from '@teable-group/core';
import { ANONYMOUS_USER_ID, FieldType, Relationship, ViewType } from '@teable-group/core';
import {
  enableShareView as apiEnableShareView,
  getShareViewLinkRecords as apiGetShareViewLinkRecords,
  setViewFilter as apiSetViewFilter,
  SHARE_VIEW_FORM_SUBMIT,
  SHARE_VIEW_GET,
  type ShareViewGetVo,
  urlBuilder,
} from '@teable-group/openapi';
import { map } from 'lodash';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import {
  createTable,
  createView,
  deleteTable,
  initApp,
  updateViewColumnMeta,
} from './utils/init-app';

describe('OpenAPI ShareController (e2e)', () => {
  let app: INestApplication;
  let tableId: string;
  let shareId: string;
  let viewId: string;
  const baseId = globalThis.testConfig.baseId;
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
    await deleteTable(baseId, tableId);

    await app.close();
  });

  it('getShareView', async () => {
    const result = await anonymousUser.get<ShareViewGetVo>(urlBuilder(SHARE_VIEW_GET, { shareId }));
    const shareViewData = result.data;
    // filter hidden field
    expect(shareViewData.fields.length).toEqual(fieldIds.length - 1);
    expect(shareViewData.viewId).toEqual(viewId);
  });

  describe('Share from view', () => {
    let formViewId: string;
    let fromViewShareId: string;

    beforeEach(async () => {
      const viewRo: IViewRo = {
        name: 'Form view',
        description: 'the form view',
        type: ViewType.Form,
      };

      const result = await createView(tableId, viewRo);
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
  });

  describe('getLinkRecords', () => {
    let linkTableRes: ITableFullVo;
    const linkPrimaryFieldName = 'Text1';
    const linkTableRecords = [
      { fields: { [linkPrimaryFieldName]: '1' } },
      { fields: { [linkPrimaryFieldName]: '2' } },
      { fields: { [linkPrimaryFieldName]: '3' } },
    ];

    beforeAll(async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: tableId,
        },
      };

      linkTableRes = await createTable(baseId, {
        name: 'linkTable',
        fields: [
          {
            name: linkPrimaryFieldName,
            type: FieldType.SingleLineText,
          },
          linkFieldRo,
        ],
        records: linkTableRecords,
      });
    });

    afterAll(async () => {
      await deleteTable(baseId, linkTableRes.id);
    });

    it('should return link records independent of views', async () => {
      await apiSetViewFilter(linkTableRes.id, linkTableRes.defaultViewId!, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: linkTableRes.fields[0].id,
              operator: 'is',
              value: '1',
            },
          ],
        },
      });

      const result = await apiGetShareViewLinkRecords(shareId, { tableId: linkTableRes.id });
      const linkRecords = result.data.records;
      expect(linkRecords.map((record) => record.fields)).toEqual(
        linkTableRecords.map((record) => record.fields)
      );
    });

    it('should return a prohibition, passing in a table that exists but is not inside the association', async () => {
      await expect(apiGetShareViewLinkRecords(shareId, { tableId })).rejects.toThrow(
        'tableId is not allowed'
      );
    });
  });
});
