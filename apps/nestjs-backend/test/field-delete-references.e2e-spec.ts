import type { INestApplication } from '@nestjs/common';
import {
  ColorConfigType,
  FieldType,
  Relationship,
  SortFunc,
  ViewType,
  type IFilterRo,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import {
  createBase,
  getFieldDeleteReferences,
  permanentDeleteBase,
  updateViewGroup,
  updateViewSort,
} from '@teable/openapi';
import {
  createField,
  createTable,
  createView,
  initApp,
  permanentDeleteTable,
  updateViewFilter,
} from './utils/init-app';

describe('OpenAPI get field delete references (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let baseId: string;
  const spaceId = globalThis.testConfig.spaceId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = appCtx.app.get(PrismaService);
    const base = await createBase({
      spaceId,
      name: 'DeleteRefBase',
    });
    baseId = base.data.id;
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId);
    if (app) {
      await app.close();
    }
  });

  describe('dependent field analysis', () => {
    let hostTable: ITableFullVo | undefined;
    let foreignTable: ITableFullVo | undefined;
    let table: ITableFullVo | undefined;

    afterEach(async () => {
      if (hostTable?.id) {
        await permanentDeleteTable(baseId, hostTable.id);
      }
      if (foreignTable?.id) {
        await permanentDeleteTable(baseId, foreignTable.id);
      }
      if (table?.id) {
        await permanentDeleteTable(baseId, table.id);
      }
      hostTable = undefined;
      foreignTable = undefined;
      table = undefined;
    });

    it('detects one-way link display dependencies via lookupFieldId and visibleFieldIds', async () => {
      foreignTable = await createTable(baseId, {
        name: 'DeleteRefForeign',
        fields: [
          { name: 'Display Field', type: FieldType.SingleLineText },
          { name: 'Other Field', type: FieldType.SingleLineText },
        ],
      });
      hostTable = await createTable(baseId, {
        name: 'DeleteRefHost',
      });

      const displayField = foreignTable.fields.find((f) => f.name === 'Display Field')!;
      const otherField = foreignTable.fields.find((f) => f.name === 'Other Field')!;

      const hostLinkField = await createField(hostTable.id, {
        name: 'Foreign Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
          isOneWay: true,
          lookupFieldId: displayField.id,
          visibleFieldIds: [displayField.id],
        },
      });

      const displayRefs = await getFieldDeleteReferences(foreignTable.id, [displayField.id]);
      const displayDepItems = displayRefs.data[displayField.id].dependentFields.filter(
        (item) => item.id === hostLinkField.id
      );
      expect(displayDepItems).toHaveLength(1);
      expect(displayDepItems[0]).toMatchObject({
        id: hostLinkField.id,
        name: hostLinkField.name,
        type: FieldType.Link,
        source: {
          id: hostTable.id,
          name: hostTable.name,
        },
      });

      const otherRefs = await getFieldDeleteReferences(foreignTable.id, [otherField.id]);
      expect(
        otherRefs.data[otherField.id].dependentFields.some((item) => item.id === hostLinkField.id)
      ).toBeFalsy();
    });

    it('excludes fields that are deleted in the same batch from dependentFields', async () => {
      table = await createTable(baseId, {
        name: 'DeleteRefBatch',
        fields: [{ name: 'Source', type: FieldType.SingleLineText }],
      });

      const sourceField = table.fields.find((f) => f.name === 'Source')!;
      const formulaField = await createField(table.id, {
        name: 'Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${sourceField.id}}`,
        },
      });

      const singleDeleteRefs = await getFieldDeleteReferences(table.id, [sourceField.id]);
      expect(
        singleDeleteRefs.data[sourceField.id].dependentFields.some(
          (item) => item.id === formulaField.id
        )
      ).toBeTruthy();

      const batchDeleteRefs = await getFieldDeleteReferences(table.id, [
        sourceField.id,
        formulaField.id,
      ]);
      expect(
        batchDeleteRefs.data[sourceField.id].dependentFields.some(
          (item) => item.id === formulaField.id
        )
      ).toBeFalsy();
    });

    it('returns empty references for out-of-table or missing field ids', async () => {
      hostTable = await createTable(baseId, {
        name: 'DeleteRefMainTable',
      });
      foreignTable = await createTable(baseId, {
        name: 'DeleteRefOtherTable',
      });

      const foreignPrimaryFieldId = foreignTable.fields[0].id;
      const missingFieldId = 'fld_missing_delete_ref';

      const refs = await getFieldDeleteReferences(hostTable.id, [
        foreignPrimaryFieldId,
        missingFieldId,
      ]);

      expect(refs.data[foreignPrimaryFieldId]).toEqual({
        workflowNodes: [],
        authorityMatrixRoles: [],
        views: [],
        dependentFields: [],
      });
      expect(refs.data[missingFieldId]).toEqual({
        workflowNodes: [],
        authorityMatrixRoles: [],
        views: [],
        dependentFields: [],
      });
    });

    it('detects view references from filters and all supported view options', async () => {
      const textFieldName = 'Text Field';
      const statusFieldName = 'Status';
      const attachmentFieldName = 'Attachment';
      const startDateFieldName = 'Start Date';
      const endDateFieldName = 'End Date';
      table = await createTable(baseId, {
        name: 'DeleteRefViews',
        fields: [
          { name: textFieldName, type: FieldType.SingleLineText },
          { name: statusFieldName, type: FieldType.SingleSelect },
          { name: attachmentFieldName, type: FieldType.Attachment },
          { name: startDateFieldName, type: FieldType.Date },
          { name: endDateFieldName, type: FieldType.Date },
        ],
      });

      const textField = table.fields.find((f) => f.name === textFieldName)!;
      const statusField = table.fields.find((f) => f.name === statusFieldName)!;
      const attachmentField = table.fields.find((f) => f.name === attachmentFieldName)!;
      const startDateField = table.fields.find((f) => f.name === startDateFieldName)!;
      const endDateField = table.fields.find((f) => f.name === endDateFieldName)!;

      const filterView = await createView(table.id, { name: 'Filter View', type: ViewType.Grid });
      const filterRo: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: textField.id, operator: 'is', value: 'x' }],
        },
      };
      await updateViewFilter(table.id, filterView.id, filterRo);

      const sortView = await createView(table.id, { name: 'Sort View', type: ViewType.Grid });
      await updateViewSort(table.id, sortView.id, {
        sort: { sortObjs: [{ fieldId: textField.id, order: SortFunc.Asc }] },
      });

      const groupView = await createView(table.id, { name: 'Group View', type: ViewType.Grid });
      await updateViewGroup(table.id, groupView.id, {
        group: [{ fieldId: textField.id, order: SortFunc.Desc }],
      });

      const gridView = await createView(table.id, {
        name: 'Grid View',
        type: ViewType.Grid,
        options: { frozenFieldId: textField.id },
      });

      const kanbanView = await createView(table.id, {
        name: 'Kanban View',
        type: ViewType.Kanban,
        options: { stackFieldId: statusField.id, coverFieldId: attachmentField.id },
      });

      const galleryView = await createView(table.id, {
        name: 'Gallery View',
        type: ViewType.Gallery,
        options: { coverFieldId: attachmentField.id },
      });

      const calendarView = await createView(table.id, {
        name: 'Calendar View',
        type: ViewType.Calendar,
        options: {
          startDateFieldId: startDateField.id,
          endDateFieldId: endDateField.id,
          titleFieldId: textField.id,
          colorConfig: {
            type: ColorConfigType.Field,
            fieldId: statusField.id,
          },
        },
      });

      const refs = await getFieldDeleteReferences(table.id, [
        textField.id,
        statusField.id,
        attachmentField.id,
        startDateField.id,
        endDateField.id,
      ]);
      const textRefViewIds = refs.data[textField.id].views.map((view) => view.id);
      expect(textRefViewIds).toEqual(
        expect.arrayContaining([
          filterView.id,
          sortView.id,
          groupView.id,
          gridView.id,
          calendarView.id,
        ])
      );

      const statusRefViewIds = refs.data[statusField.id].views.map((view) => view.id);
      expect(statusRefViewIds).toEqual(expect.arrayContaining([kanbanView.id, calendarView.id]));

      const attachmentRefViewIds = refs.data[attachmentField.id].views.map((view) => view.id);
      expect(attachmentRefViewIds).toEqual(expect.arrayContaining([kanbanView.id, galleryView.id]));

      const startDateRefViewIds = refs.data[startDateField.id].views.map((view) => view.id);
      expect(startDateRefViewIds).toContain(calendarView.id);

      const endDateRefViewIds = refs.data[endDateField.id].views.map((view) => view.id);
      expect(endDateRefViewIds).toContain(calendarView.id);
    });

    it('ignores malformed view JSON and still returns references safely', async () => {
      const textFieldName = 'Text Field';
      const malformedJson = '{broken-json';
      table = await createTable(baseId, {
        name: 'DeleteRefMalformedView',
        fields: [{ name: textFieldName, type: FieldType.SingleLineText }],
      });

      const textField = table.fields.find((f) => f.name === textFieldName)!;

      await prisma.view.update({
        where: { id: table.defaultViewId! },
        data: {
          filter: malformedJson,
          sort: malformedJson,
          group: malformedJson,
          options: malformedJson,
        },
      });

      const refs = await getFieldDeleteReferences(table.id, [textField.id]);
      expect(refs.data[textField.id]).toEqual({
        workflowNodes: [],
        authorityMatrixRoles: [],
        views: [],
        dependentFields: [],
      });
    });
  });
});
