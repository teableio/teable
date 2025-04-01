/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldType, ViewType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { createField, getFields, duplicateField, createView, getView } from '@teable/openapi';
import { omit, pick } from 'lodash';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';

import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('OpenAPI FieldOpenApiController for duplicate field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('duplicate all common fields', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      subTable.fields = (await getFields(subTable.id)).data;

      const nonCommonFieldType = [FieldType.Link, FieldType.Rollup, FieldType.Formula];
      const commonFields = table.fields.filter((field) => !nonCommonFieldType.includes(field.type));

      for (const field of commonFields) {
        await duplicateField(table.id, field.id, {
          name: `${field.name}_copy`,
        });
      }

      const fields = (await getFields(table.id)).data;
      const copiedFields = fields.filter((field) => field.name.endsWith('_copy'));

      expect(copiedFields.length).toBe(commonFields.length);

      expect(copiedFields.map((f) => omit(f, ['name', 'dbFieldName', 'id', 'isPrimary']))).toEqual(
        commonFields.map((f) => omit(f, ['name', 'dbFieldName', 'id', 'isPrimary']))
      );
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });
  });

  describe('duplicate link fields', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      subTable.fields = (await getFields(subTable.id)).data;

      const linkFields = table.fields.filter(
        (field) => field.type === FieldType.Link && !field.isLookup
      );

      for (const field of linkFields) {
        await duplicateField(table.id, field.id, {
          name: `${field.name}_copy`,
        });
      }

      const fields = (await getFields(table.id)).data;
      const copiedFields = fields.filter((field) => field.name.endsWith('_copy'));

      expect(copiedFields.length).toBe(linkFields.length);

      const copiedLinkFields = copiedFields
        .filter((field) => field.type === FieldType.Link)
        .map((f) => {
          return {
            ...omit(f, ['name', 'dbFieldName', 'id', 'isPrimary']),
            options: {
              ...pick(f.options, ['foreignTableId', 'isOneWay', 'relationship', 'lookupFieldId']),
            },
          };
        });

      const assertLinkFields = linkFields.map((f) => {
        return {
          ...omit(f, ['name', 'dbFieldName', 'id', 'isPrimary']),
          options: {
            ...pick(f.options, ['foreignTableId', 'isOneWay', 'relationship', 'lookupFieldId']),
            // all be one way
            isOneWay: true,
          },
        };
      });

      expect(copiedLinkFields).toEqual(assertLinkFields);
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });
  });

  describe('duplicate lookup fields', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      subTable.fields = (await getFields(subTable.id)).data;

      const lookupFields = table.fields.filter((field) => field.isLookup);

      for (const field of lookupFields) {
        await duplicateField(table.id, field.id, {
          name: `${field.name}_copy`,
        });
      }

      const fields = (await getFields(table.id)).data;
      const copiedFields = fields.filter((field) => field.name.endsWith('_copy'));

      expect(copiedFields.length).toBe(lookupFields.length);

      expect(copiedFields.map((f) => omit(f, ['name', 'dbFieldName', 'id', 'isPrimary']))).toEqual(
        lookupFields.map((f) => omit(f, ['name', 'dbFieldName', 'id', 'isPrimary']))
      );
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });
  });

  describe('duplicate rollup fields', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      subTable.fields = (await getFields(subTable.id)).data;

      const linkField = table.fields.filter(
        (field) => field.type === FieldType.Link && !field.isLookup
      )[0]!;

      const linkOption = linkField.options as ILinkFieldOptions;

      const rollupField = (
        await createField(table.id, {
          type: FieldType.Rollup,
          name: 'rollup_field',
          lookupOptions: {
            foreignTableId: linkOption.foreignTableId,
            lookupFieldId: linkOption.lookupFieldId,
            linkFieldId: linkField.id,
          },
          options: {
            expression: 'countall({values})',
            formatting: {
              precision: 2,
              type: 'decimal',
            },
            timeZone: 'Asia/Shanghai',
          },
        })
      ).data;

      await duplicateField(table.id, rollupField.id, {
        name: `${rollupField.name}_copy`,
      });

      const fields = (await getFields(table.id)).data;

      const copiedRollupField = fields.find((f) => f.name.endsWith('_copy'))!;

      const expectedRollupField = {
        ...omit(copiedRollupField, ['name', 'dbFieldName', 'id', 'isPrimary']),
        options: {
          ...rollupField.options,
          expression: 'countall({values})',
        },
        isPending: true,
      };
      const assertRollupField = {
        ...omit(rollupField, ['name', 'dbFieldName', 'id', 'isPrimary']),
      };

      expect(expectedRollupField).toEqual(assertRollupField);
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });
  });

  describe('duplicate field with view new field order should next to the original field', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const view = (
        await createView(table.id, {
          name: 'view_x_20',
          type: ViewType.Grid,
        })
      ).data;

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      subTable.fields = (await getFields(subTable.id)).data;

      const textField = table.fields.find((f) => f.type === FieldType.SingleLineText)!;

      const fieldCopy = (
        await duplicateField(table.id, textField.id, {
          name: `${textField.name}_copy`,
          viewId: view.id,
        })
      ).data;

      const afterDuplicateView = (await getView(table.id, view.id)).data;

      const afterDuplicateFieldIndex = afterDuplicateView.columnMeta[fieldCopy.id]?.order;
      const originalFieldIndex = view.columnMeta[textField.id]?.order;

      const getterFieldViewOrders = Object.values(view.columnMeta)
        .filter(({ order }) => originalFieldIndex < order)
        .map(({ order }) => order);

      const targetFieldViewOrder = getterFieldViewOrders?.length
        ? (getterFieldViewOrders[0] + originalFieldIndex) / 2
        : originalFieldIndex + 1;

      expect(afterDuplicateFieldIndex).toBe(targetFieldViewOrder);
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });
  });
});
