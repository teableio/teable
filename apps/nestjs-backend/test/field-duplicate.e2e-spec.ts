/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type {
  IButtonFieldCellValue,
  IFieldRo,
  ILinkFieldOptions,
  INumberFormatting,
} from '@teable/core';
import {
  Colors,
  FieldKeyType,
  FieldType,
  generateFieldId,
  generateWorkflowId,
  Relationship,
  ViewType,
} from '@teable/core';
import type { ICreateBaseVo, ITableFullVo } from '@teable/openapi';
import {
  createField,
  getFields,
  duplicateField,
  createView,
  getView,
  buttonClick,
  createBase,
} from '@teable/openapi';
import { omit, pick } from 'lodash';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';

import {
  createTable,
  permanentDeleteTable,
  initApp,
  createRecords,
  getRecords,
  convertField,
} from './utils/init-app';

describe('OpenAPI FieldOpenApiController for duplicate field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const spaceId = globalThis.testConfig.spaceId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  describe('duplicate formula fields with auto number metadata', () => {
    let table: ITableFullVo;
    let autoFieldId: string;
    let autoLenFieldId: string;

    beforeAll(async () => {
      autoFieldId = generateFieldId();
      table = await createTable(baseId, {
        name: 'auto-len-duplicate',
        fields: [
          {
            id: autoFieldId,
            name: 'auto',
            type: FieldType.AutoNumber,
          },
        ],
      });

      await createField(table.id, {
        name: 'auto-len',
        type: FieldType.Formula,
        options: {
          expression: `LEN({${autoFieldId}})`,
        },
      });
      const fields = (await getFields(table.id)).data;
      autoLenFieldId = fields.find((f) => f.name === 'auto-len')?.id ?? '';
      expect(autoLenFieldId).toBeTruthy();

      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {},
          },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should duplicate formula and preserve evaluation on auto number columns', async () => {
      const duplicated = await duplicateField(table.id, autoLenFieldId, {
        name: 'auto-len-copy',
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const first = records[0];

      expect(first.fields[autoLenFieldId]).toEqual(1);
      expect(first.fields[duplicated.data.id]).toEqual(1);
    });
  });

  describe('duplicate field response compatibility under FORCE_V2', () => {
    let table: ITableFullVo;
    let foreignTable: ITableFullVo;
    let linkFieldId: string;
    let foreignPrimaryFieldId: string;

    beforeAll(async () => {
      foreignTable = await createTable(baseId, {
        name: 'dup_force_v2_compat_foreign',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'foreign_name',
          },
        ],
      });
      foreignPrimaryFieldId = foreignTable.fields.find((f) => f.isPrimary)!.id;

      table = await createTable(baseId, {
        name: 'dup_force_v2_compat_main',
      });

      const linkField = (
        await createField(table.id, {
          type: FieldType.Link,
          name: 'to_foreign',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
            isOneWay: false,
          },
        })
      ).data;
      linkFieldId = linkField.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, foreignTable.id);
    });

    it('keeps description but omits false/linked compatibility keys in duplicated fields', async () => {
      const describedField = (
        await createField(table.id, {
          type: FieldType.Number,
          name: 'number_with_description',
          description: 'description_kept',
        })
      ).data;
      const duplicatedDescribedField = (
        await duplicateField(table.id, describedField.id, {
          name: 'number_with_description_copy',
        })
      ).data;
      expect(duplicatedDescribedField.description).toBe('description_kept');

      const lookupField = (
        await createField(table.id, {
          type: FieldType.SingleLineText,
          name: 'lookup_force_v2_compat',
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreignTable.id,
            linkFieldId,
            lookupFieldId: foreignPrimaryFieldId,
          },
        })
      ).data;
      const duplicatedLookupField = (
        await duplicateField(table.id, lookupField.id, {
          name: 'lookup_force_v2_compat_copy',
        })
      ).data;
      const duplicatedLookupOptions = duplicatedLookupField.lookupOptions as
        | Record<string, unknown>
        | undefined;

      expect(Object.prototype.hasOwnProperty.call(duplicatedLookupOptions ?? {}, 'isOneWay')).toBe(
        false
      );
      expect(
        Object.prototype.hasOwnProperty.call(duplicatedLookupOptions ?? {}, 'symmetricFieldId')
      ).toBe(false);

      const rollupField = (
        await createField(table.id, {
          type: FieldType.Rollup,
          name: 'rollup_force_v2_compat',
          lookupOptions: {
            foreignTableId: foreignTable.id,
            linkFieldId,
            lookupFieldId: foreignPrimaryFieldId,
          },
          options: {
            expression: 'countall({values})',
          },
        })
      ).data;
      const duplicatedRollupField = (
        await duplicateField(table.id, rollupField.id, {
          name: 'rollup_force_v2_compat_copy',
        })
      ).data;
      const duplicatedRollupLookupOptions = duplicatedRollupField.lookupOptions as
        | Record<string, unknown>
        | undefined;

      expect(
        Object.prototype.hasOwnProperty.call(duplicatedRollupLookupOptions ?? {}, 'isOneWay')
      ).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(
          duplicatedRollupLookupOptions ?? {},
          'symmetricFieldId'
        )
      ).toBe(false);

      const buttonField = (
        await createField(table.id, {
          type: FieldType.Button,
          name: 'button_force_v2_compat',
          options: {
            label: 'go',
            color: Colors.Blue,
            workflow: {
              id: generateWorkflowId(),
              name: 'wf_for_compat',
              isActive: true,
            },
          },
        })
      ).data;
      const duplicatedButtonField = (
        await duplicateField(table.id, buttonField.id, {
          name: 'button_force_v2_compat_copy',
        })
      ).data;

      expect(duplicatedButtonField.isMultipleCellValue).toBeUndefined();
    });
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

      const nonCommonFieldType = [
        FieldType.Link,
        FieldType.Rollup,
        FieldType.Formula,
        FieldType.Button,
      ];
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

  describe('duplicate cross-base link fields', () => {
    let table: ITableFullVo;
    let crossTable: ITableFullVo;
    let otherBase: ICreateBaseVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'main_table',
        fields: x_20.fields,
      });

      otherBase = (
        await createBase({
          spaceId,
          name: 'other-base',
        })
      ).data;

      crossTable = await createTable(otherBase.id, {
        name: 'record_query_x_20',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'single_line_text',
          },
        ],
      });
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, crossTable.id);
    });

    it('should duplicate link field with cross-base table', async () => {
      const linkField = (
        await createField(table.id, {
          type: FieldType.Link,
          name: 'link',
          options: {
            baseId: otherBase.id,
            foreignTableId: crossTable.id,
            relationship: Relationship.ManyMany,
          },
        })
      ).data;

      const copiedLinkField = (
        await duplicateField(table.id, linkField.id, {
          name: `${linkField.name}_copy`,
        })
      ).data;

      expect(
        pick(copiedLinkField.options, ['baseId', 'foreignTableId', 'relationship', 'isOneWay'])
      ).toEqual({
        baseId: otherBase.id,
        foreignTableId: crossTable.id,
        relationship: Relationship.ManyMany,
        isOneWay: true,
      });
    });
  });

  describe('duplicate lookup with nested multi-hop dependencies', () => {
    let seasonTable: ITableFullVo;
    let productTable: ITableFullVo;
    let mainTable: ITableFullVo;
    let seasonNameFieldId: string;
    let productNameFieldId: string;
    let orderNameFieldId: string;
    let productSeasonLinkId: string;
    let productSeasonLookupId: string;
    let mainProductLinkId: string;
    let mainSeasonLookupId: string;

    beforeAll(async () => {
      seasonTable = await createTable(baseId, {
        name: 'season_table_nested_lookup',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'season_name',
          },
        ],
      });
      seasonNameFieldId = seasonTable.fields.find((f) => f.name === 'season_name')!.id;
      const seasonRecords = await createRecords(seasonTable.id, {
        records: [
          { fields: { [seasonNameFieldId]: 'Spring' } },
          { fields: { [seasonNameFieldId]: 'Autumn' } },
        ],
      });

      productTable = await createTable(baseId, {
        name: 'product_table_nested_lookup',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'product_name',
          },
        ],
      });
      productNameFieldId = productTable.fields.find((f) => f.name === 'product_name')!.id;

      const productSeasonLink = (
        await createField(productTable.id, {
          type: FieldType.Link,
          name: 'season_link',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: seasonTable.id,
          },
        })
      ).data;
      productSeasonLinkId = productSeasonLink.id;

      const productSeasonLookup = (
        await createField(productTable.id, {
          type: FieldType.SingleLineText,
          name: 'season_lookup',
          isLookup: true,
          lookupOptions: {
            foreignTableId: seasonTable.id,
            linkFieldId: productSeasonLinkId,
            lookupFieldId: seasonNameFieldId,
          },
        })
      ).data;
      productSeasonLookupId = productSeasonLookup.id;

      const productRecords = await createRecords(productTable.id, {
        records: [
          {
            fields: {
              [productNameFieldId]: 'Starter Pack',
              [productSeasonLinkId]: [{ id: seasonRecords.records[0].id }],
            },
          },
          {
            fields: {
              [productNameFieldId]: 'Advanced Pack',
              [productSeasonLinkId]: [{ id: seasonRecords.records[1].id }],
            },
          },
        ],
      });

      mainTable = await createTable(baseId, {
        name: 'main_table_nested_lookup',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'order_name',
          },
        ],
      });
      orderNameFieldId = mainTable.fields.find((f) => f.name === 'order_name')!.id;

      const mainProductLink = (
        await createField(mainTable.id, {
          type: FieldType.Link,
          name: 'product_link',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: productTable.id,
          },
        })
      ).data;
      mainProductLinkId = mainProductLink.id;

      const mainSeasonLookup = (
        await createField(mainTable.id, {
          type: FieldType.SingleLineText,
          name: 'season_lookup',
          isLookup: true,
          lookupOptions: {
            foreignTableId: productTable.id,
            linkFieldId: mainProductLinkId,
            lookupFieldId: productSeasonLookupId,
          },
        })
      ).data;
      mainSeasonLookupId = mainSeasonLookup.id;

      await createRecords(mainTable.id, {
        records: [
          {
            fields: {
              [orderNameFieldId]: 'Order-1',
              [mainProductLinkId]: productRecords.records.map((rec) => ({ id: rec.id })),
            },
          },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, mainTable.id);
      await permanentDeleteTable(baseId, productTable.id);
      await permanentDeleteTable(baseId, seasonTable.id);
    });

    it('duplicates multi-hop lookup field without missing CTEs', async () => {
      const duplicatedLookup = (
        await duplicateField(mainTable.id, mainSeasonLookupId, {
          name: 'season_lookup_copy',
        })
      ).data;

      expect(duplicatedLookup.isLookup).toBe(true);
      expect(duplicatedLookup.lookupOptions?.lookupFieldId).toBe(productSeasonLookupId);

      const records = await getRecords(mainTable.id, {
        fieldKeyType: FieldKeyType.Id,
        projection: [orderNameFieldId, mainSeasonLookupId, duplicatedLookup.id],
      });

      const orderRecord = records.records.find(
        (record) => record.fields[orderNameFieldId] === 'Order-1'
      );
      expect(orderRecord).toBeDefined();
      expect(orderRecord!.fields[duplicatedLookup.id]).toEqual(
        orderRecord!.fields[mainSeasonLookupId]
      );
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

    it('keeps symmetric field names unique after converting a duplicated one-way link back to two-way', async () => {
      let sourceTable: ITableFullVo | undefined;
      let foreignTable: ITableFullVo | undefined;

      try {
        sourceTable = await createTable(baseId, {
          name: 'dup_link_name_source',
          fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true } as IFieldRo],
        });

        foreignTable = await createTable(baseId, {
          name: 'dup_link_name_foreign',
          fields: [{ name: 'Title', type: FieldType.SingleLineText, isPrimary: true } as IFieldRo],
        });

        const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
        expect(foreignPrimaryFieldId).toBeDefined();
        if (!foreignPrimaryFieldId) {
          throw new Error('Missing foreign primary field');
        }

        const originalField = (
          await createField(sourceTable.id, {
            type: FieldType.Link,
            name: 'Customer',
            options: {
              relationship: Relationship.ManyMany,
              foreignTableId: foreignTable.id,
              lookupFieldId: foreignPrimaryFieldId,
              isOneWay: false,
            },
          })
        ).data;

        const originalSymmetricFieldId = (originalField.options as ILinkFieldOptions)
          .symmetricFieldId;
        expect(originalSymmetricFieldId).toBeDefined();
        if (!originalSymmetricFieldId) {
          throw new Error('Missing original symmetric field');
        }

        const duplicatedField = (
          await duplicateField(sourceTable.id, originalField.id, {
            name: 'Customer Copy',
          })
        ).data;

        expect((duplicatedField.options as ILinkFieldOptions).isOneWay).toBe(true);
        expect((duplicatedField.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

        const convertedField = await convertField(sourceTable.id, duplicatedField.id, {
          type: FieldType.Link,
          name: duplicatedField.name,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            isOneWay: false,
          },
        });

        const convertedSymmetricFieldId = (convertedField.options as ILinkFieldOptions)
          .symmetricFieldId;
        expect(convertedSymmetricFieldId).toBeDefined();
        if (!convertedSymmetricFieldId) {
          throw new Error('Missing converted symmetric field');
        }

        const foreignFields = (await getFields(foreignTable.id)).data;
        const originalSymmetricField = foreignFields.find(
          (field) => field.id === originalSymmetricFieldId
        );
        const convertedSymmetricField = foreignFields.find(
          (field) => field.id === convertedSymmetricFieldId
        );

        expect(originalSymmetricField?.name).toBeDefined();
        expect(convertedSymmetricField?.name).toBeDefined();
        expect(originalSymmetricField?.name).not.toBe(convertedSymmetricField?.name);
        expect(new Set([originalSymmetricField?.name, convertedSymmetricField?.name]).size).toBe(2);
      } finally {
        if (sourceTable) {
          await permanentDeleteTable(baseId, sourceTable.id);
        }
        if (foreignTable) {
          await permanentDeleteTable(baseId, foreignTable.id);
        }
      }
    });
  });

  describe('duplicate link field should copy cell data', () => {
    let foreignTable: ITableFullVo;
    let mainTable: ITableFullVo;
    let linkFieldId: string;

    beforeAll(async () => {
      // create foreign table with some records
      foreignTable = await createTable(baseId, { name: 'dup_link_foreign' });
      const primaryFieldId = foreignTable.fields.find((f) => f.isPrimary)!.id;
      const created = await createRecords(foreignTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [primaryFieldId]: 'A1' } },
          { fields: { [primaryFieldId]: 'A2' } },
          { fields: { [primaryFieldId]: 'A3' } },
        ],
      });

      // create main table and a link field to foreignTable
      mainTable = await createTable(baseId, { name: 'dup_link_main' });
      const linkField = (
        await createField(mainTable.id, {
          type: FieldType.Link,
          name: 'link_to_foreign',
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreignTable.id,
          },
        })
      ).data;
      linkFieldId = linkField.id;

      // create records in main table with link values
      await createRecords(mainTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [linkFieldId]: [{ id: created.records[0].id }, { id: created.records[1].id }],
            },
          },
          {
            fields: {
              [linkFieldId]: [{ id: created.records[2].id }],
            },
          },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, mainTable.id);
      await permanentDeleteTable(baseId, foreignTable.id);
    });

    it('should duplicate link field and preserve all cell values', async () => {
      const copied = (
        await duplicateField(mainTable.id, linkFieldId, {
          name: 'link_to_foreign_copy',
        })
      ).data;

      const { records } = await getRecords(mainTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      for (const r of records) {
        expect(r.fields[copied.id]).toEqual(r.fields[linkFieldId]);
      }
    });
  });

  describe('duplicate common fields should copy cell data', () => {
    let table: ITableFullVo;
    let textFieldId: string;
    let numberFieldId: string;
    let checkboxFieldId: string;

    beforeAll(async () => {
      // create base table
      table = await createTable(baseId, { name: 'dup_common_main' });

      // add three common fields
      textFieldId = (
        await createField(table.id, {
          type: FieldType.SingleLineText,
          name: 'text_col',
        })
      ).data.id;

      numberFieldId = (
        await createField(table.id, {
          type: FieldType.Number,
          name: 'num_col',
        })
      ).data.id;

      checkboxFieldId = (
        await createField(table.id, {
          type: FieldType.Checkbox,
          name: 'bool_col',
        })
      ).data.id;

      // seed a few records with mixed values (including nulls/false)
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [textFieldId]: 'hello',
              [numberFieldId]: 42,
              [checkboxFieldId]: true,
            },
          },
          {
            fields: {
              [textFieldId]: 'world',
              [numberFieldId]: null,
              [checkboxFieldId]: false,
            },
          },
          {
            fields: {
              [textFieldId]: null,
              [numberFieldId]: 0,
              [checkboxFieldId]: true,
            },
          },
        ],
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should duplicate text/number/checkbox fields and preserve all cell values', async () => {
      const copiedText = (
        await duplicateField(table.id, textFieldId, {
          name: 'text_col_copy',
        })
      ).data;

      const copiedNumber = (
        await duplicateField(table.id, numberFieldId, {
          name: 'num_col_copy',
        })
      ).data;

      const copiedCheckbox = (
        await duplicateField(table.id, checkboxFieldId, {
          name: 'bool_col_copy',
        })
      ).data;

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });

      for (const r of records) {
        expect(r.fields[copiedText.id]).toEqual(r.fields[textFieldId]);
        expect(r.fields[copiedNumber.id]).toEqual(r.fields[numberFieldId]);
        expect(r.fields[copiedCheckbox.id]).toEqual(r.fields[checkboxFieldId]);
      }
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

  describe('duplicate filtered lookup fields that target conditional lookups', () => {
    let issuesTable: ITableFullVo;
    let releasesTable: ITableFullVo;
    let launchesTable: ITableFullVo;
    let originalForceV2All: string | undefined;
    let issueTitleFieldId: string;
    let issuePrFieldId: string;
    let releasePrFieldId: string;
    let releaseEditionFieldId: string;
    let issuesTitleLookupFieldId: string;
    let relatedReleasesFieldId: string;
    let releaseIssuesFieldId: string;

    beforeAll(async () => {
      originalForceV2All = process.env.FORCE_V2_ALL;
      process.env.FORCE_V2_ALL = 'false';

      issuesTable = await createTable(baseId, {
        name: 'duplicate_nested_lookup_issues',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'PR', type: FieldType.SingleLineText },
        ],
      });

      const issueFields = (await getFields(issuesTable.id)).data;
      issueTitleFieldId = issueFields.find((field) => field.name === 'Title')!.id;
      issuePrFieldId = issueFields.find((field) => field.name === 'PR')!.id;

      releasesTable = await createTable(baseId, {
        name: 'duplicate_nested_lookup_releases',
        fields: [
          { name: 'Tag', type: FieldType.SingleLineText },
          { name: 'PR', type: FieldType.SingleLineText },
          {
            name: 'Edition',
            type: FieldType.SingleSelect,
            options: {
              choices: [{ name: 'cloud' }, { name: 'ee' }],
            },
          },
        ],
      });

      const releaseFields = (await getFields(releasesTable.id)).data;
      releasePrFieldId = releaseFields.find((field) => field.name === 'PR')!.id;
      releaseEditionFieldId = releaseFields.find((field) => field.name === 'Edition')!.id;

      issuesTitleLookupFieldId = (
        await createField(releasesTable.id, {
          name: 'Issues title',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: issuesTable.id,
            lookupFieldId: issueTitleFieldId,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: issuePrFieldId,
                  operator: 'is',
                  value: {
                    type: 'field',
                    fieldId: releasePrFieldId,
                    tableId: releasesTable.id,
                  },
                },
              ],
            },
          },
        })
      ).data.id;

      launchesTable = await createTable(baseId, {
        name: 'duplicate_nested_lookup_launches',
        fields: [{ name: 'Launch', type: FieldType.SingleLineText }],
      });

      relatedReleasesFieldId = (
        await createField(launchesTable.id, {
          name: 'Related Releases',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: releasesTable.id,
            isOneWay: false,
          },
        })
      ).data.id;

      releaseIssuesFieldId = (
        await createField(launchesTable.id, {
          name: 'Release Issues',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: releasesTable.id,
            linkFieldId: relatedReleasesFieldId,
            lookupFieldId: issuesTitleLookupFieldId,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: releaseEditionFieldId,
                  operator: 'is',
                  value: 'cloud',
                },
              ],
            },
          },
        })
      ).data.id;

      process.env.FORCE_V2_ALL = originalForceV2All;
    });

    afterAll(async () => {
      process.env.FORCE_V2_ALL = originalForceV2All;
      await permanentDeleteTable(baseId, launchesTable.id);
      await permanentDeleteTable(baseId, releasesTable.id);
      await permanentDeleteTable(baseId, issuesTable.id);
    });

    it('should duplicate filtered lookups whose source field is conditional lookup', async () => {
      const duplicated = (
        await duplicateField(launchesTable.id, releaseIssuesFieldId, {
          name: 'Release Issues Copy',
        })
      ).data;

      expect(duplicated.isLookup).toBe(true);
      expect(duplicated.isConditionalLookup).not.toBe(true);
      expect(duplicated.lookupOptions).toMatchObject({
        foreignTableId: releasesTable.id,
        linkFieldId: relatedReleasesFieldId,
        lookupFieldId: issuesTitleLookupFieldId,
        filter: {
          conjunction: 'and',
          filterSet: [
            expect.objectContaining({
              fieldId: releaseEditionFieldId,
              operator: 'is',
              value: 'cloud',
            }),
          ],
        },
      });
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
            } as INumberFormatting,
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
        ...omit(copiedRollupField, ['name', 'dbFieldName', 'id', 'isPrimary', 'unique']),
        options: {
          ...rollupField.options,
          expression: 'countall({values})',
        },
        isPending: true,
      };
      const assertRollupField = {
        ...omit(rollupField, ['name', 'dbFieldName', 'id', 'isPrimary', 'unique']),
      };

      expect(expectedRollupField).toEqual(assertRollupField);
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
    });
  });

  describe('duplicate button field', () => {
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

    it('should duplicate button field', async () => {
      const buttonFieldRo: IFieldRo = {
        name: 'button',
        type: FieldType.Button,
        options: {
          label: 'button label',
          color: Colors.Red,
          workflow: {
            id: generateWorkflowId(),
            name: 'workflow1',
            isActive: true,
          },
        },
      };
      const buttonField = (await createField(table1.id, buttonFieldRo)).data;

      const clickRes = await buttonClick(table1.id, table1.records[0].id, buttonField.id);
      const clickValue = clickRes.data.record.fields[buttonField.id] as IButtonFieldCellValue;
      expect(clickValue.count).toEqual(1);

      const copiedButtonField = (
        await duplicateField(table1.id, buttonField.id, {
          name: `${buttonField.name}_copy`,
        })
      ).data;

      expect(copiedButtonField.name).toBe(`${buttonField.name}_copy`);
      const expectedButtonField = {
        ...buttonField,
        options: {
          ...buttonField.options,
          workflow: undefined,
        },
      };

      const keys = ['name', 'dbFieldName', 'id', 'isPrimary'];
      expect(omit(expectedButtonField, keys)).toEqual(omit(copiedButtonField, keys));
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
