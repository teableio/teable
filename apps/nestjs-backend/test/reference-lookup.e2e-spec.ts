/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, generateFieldId, isGreater } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  convertField,
  createTable,
  deleteField,
  getField,
  getFields,
  getRecord,
  getRecords,
  getTable,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI Reference Lookup field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('table and field retrieval', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let orderId: string;
    let statusId: string;
    let statusFilterId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'RefLookup_View_Foreign',
        fields: [
          { name: 'Order', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Order: 'A-001', Status: 'Active', Amount: 10 } },
          { fields: { Order: 'A-002', Status: 'Active', Amount: 5 } },
          { fields: { Order: 'C-001', Status: 'Closed', Amount: 2 } },
        ],
      });
      orderId = foreign.fields.find((f) => f.name === 'Order')!.id;
      statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_View_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Closed' } }],
      });
      statusFilterId = host.fields.find((f) => f.name === 'StatusFilter')!.id;

      const filter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: statusFilterId },
          },
        ],
      } as any;

      lookupField = await createField(host.id, {
        name: 'Matching Orders',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: orderId,
          expression: 'count({values})',
          filter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should expose reference lookup via table and field endpoints', async () => {
      const tableInfo = await getTable(baseId, host.id);
      expect(tableInfo.id).toBe(host.id);

      const fields = await getFields(host.id);
      const retrieved = fields.find((field) => field.id === lookupField.id)!;
      expect(retrieved.type).toBe(FieldType.ReferenceLookup);
      expect((retrieved.options as any).lookupFieldId).toBe(orderId);
      expect((retrieved.options as any).foreignTableId).toBe(foreign.id);

      const fieldDetail = await getField(host.id, lookupField.id);
      expect(fieldDetail.id).toBe(lookupField.id);
      expect((fieldDetail.options as any).expression).toBe('count({values})');
      expect(fieldDetail.isComputed).toBe(true);
    });

    it('should compute lookup values for each host record', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });

      const first = records.records.find((record) => record.id === host.records[0].id)!;
      const second = records.records.find((record) => record.id === host.records[1].id)!;

      expect(first.fields[lookupField.id]).toEqual(2);
      expect(second.fields[lookupField.id]).toEqual(1);
    });
  });

  describe('filter scenarios', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let categorySumField: IFieldVo;
    let dynamicActiveCountField: IFieldVo;
    let highValueActiveCountField: IFieldVo;
    let categoryFieldId: string;
    let minimumAmountFieldId: string;
    let categoryId: string;
    let amountId: string;
    let statusId: string;
    let hardwareRecordId: string;
    let softwareRecordId: string;
    let servicesRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'RefLookup_Filter_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Laptop', Category: 'Hardware', Amount: 70, Status: 'Active' } },
          { fields: { Title: 'Mouse', Category: 'Hardware', Amount: 20, Status: 'Active' } },
          { fields: { Title: 'Subscription', Category: 'Software', Amount: 40, Status: 'Trial' } },
          { fields: { Title: 'Upgrade', Category: 'Software', Amount: 80, Status: 'Active' } },
          { fields: { Title: 'Support', Category: 'Services', Amount: 15, Status: 'Active' } },
        ],
      });
      categoryId = foreign.fields.find((f) => f.name === 'Category')!.id;
      amountId = foreign.fields.find((f) => f.name === 'Amount')!.id;
      statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_Filter_Host',
        fields: [
          { name: 'CategoryFilter', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'MinimumAmount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { CategoryFilter: 'Hardware', MinimumAmount: 50 } },
          { fields: { CategoryFilter: 'Software', MinimumAmount: 30 } },
          { fields: { CategoryFilter: 'Services', MinimumAmount: 10 } },
        ],
      });

      categoryFieldId = host.fields.find((f) => f.name === 'CategoryFilter')!.id;
      minimumAmountFieldId = host.fields.find((f) => f.name === 'MinimumAmount')!.id;
      hardwareRecordId = host.records[0].id;
      softwareRecordId = host.records[1].id;
      servicesRecordId = host.records[2].id;

      const categoryFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryFieldId },
          },
        ],
      } as any;

      categorySumField = await createField(host.id, {
        name: 'Category Total',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
          filter: categoryFilter,
        },
      } as IFieldRo);

      const dynamicActiveFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryFieldId },
          },
          {
            fieldId: statusId,
            operator: 'is',
            value: 'Active',
          },
          {
            fieldId: amountId,
            operator: 'isGreater',
            value: { type: 'field', fieldId: minimumAmountFieldId },
          },
        ],
      } as any;

      dynamicActiveCountField = await createField(host.id, {
        name: 'Dynamic Active Count',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: dynamicActiveFilter,
        },
      } as IFieldRo);

      const highValueActiveFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryFieldId },
          },
          {
            fieldId: statusId,
            operator: 'is',
            value: 'Active',
          },
          {
            fieldId: amountId,
            operator: 'isGreater',
            value: 50,
          },
        ],
      } as any;

      highValueActiveCountField = await createField(host.id, {
        name: 'High Value Active Count',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: highValueActiveFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should recalc lookup values when host filter field changes', async () => {
      const baseline = await getRecord(host.id, hardwareRecordId);
      expect(baseline.fields[categorySumField.id]).toEqual(90);

      await updateRecordByApi(host.id, hardwareRecordId, categoryFieldId, 'Software');
      const updated = await getRecord(host.id, hardwareRecordId);
      expect(updated.fields[categorySumField.id]).toEqual(120);

      await updateRecordByApi(host.id, hardwareRecordId, categoryFieldId, 'Hardware');
      const restored = await getRecord(host.id, hardwareRecordId);
      expect(restored.fields[categorySumField.id]).toEqual(90);
    });

    it('should apply field-referenced numeric filters', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareRecord = records.records.find((record) => record.id === hardwareRecordId)!;
      const softwareRecord = records.records.find((record) => record.id === softwareRecordId)!;
      const servicesRecord = records.records.find((record) => record.id === servicesRecordId)!;

      expect(hardwareRecord.fields[dynamicActiveCountField.id]).toEqual(1);
      expect(softwareRecord.fields[dynamicActiveCountField.id]).toEqual(1);
      expect(servicesRecord.fields[dynamicActiveCountField.id]).toEqual(1);
    });

    it('should support multi-condition filters with static thresholds', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareRecord = records.records.find((record) => record.id === hardwareRecordId)!;
      const softwareRecord = records.records.find((record) => record.id === softwareRecordId)!;
      const servicesRecord = records.records.find((record) => record.id === servicesRecordId)!;

      expect(hardwareRecord.fields[highValueActiveCountField.id]).toEqual(1);
      expect(softwareRecord.fields[highValueActiveCountField.id]).toEqual(1);
      expect(servicesRecord.fields[highValueActiveCountField.id]).toEqual(0);
    });

    it('should filter host records by reference lookup values', async () => {
      const filtered = await getRecords(host.id, {
        fieldKeyType: FieldKeyType.Id,
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: categorySumField.id,
              operator: isGreater.value,
              value: 100,
            },
          ],
        },
      });

      expect(filtered.records.map((record) => record.id)).toEqual([softwareRecordId]);
    });

    it('should recompute when host numeric thresholds change', async () => {
      const original = await getRecord(host.id, servicesRecordId);
      expect(original.fields[dynamicActiveCountField.id]).toEqual(1);

      await updateRecordByApi(host.id, servicesRecordId, minimumAmountFieldId, 50);
      const raisedThreshold = await getRecord(host.id, servicesRecordId);
      expect(raisedThreshold.fields[dynamicActiveCountField.id]).toEqual(0);

      await updateRecordByApi(host.id, servicesRecordId, minimumAmountFieldId, 10);
      const reset = await getRecord(host.id, servicesRecordId);
      expect(reset.fields[dynamicActiveCountField.id]).toEqual(1);
    });
  });

  describe('conversion and dependency behaviour', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let amountId: string;
    let statusId: string;
    let hostRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'RefLookup_Conversion_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', Amount: 2, Status: 'Active' } },
          { fields: { Title: 'Beta', Amount: 4, Status: 'Active' } },
          { fields: { Title: 'Gamma', Amount: 6, Status: 'Inactive' } },
        ],
      });
      amountId = foreign.fields.find((f) => f.name === 'Amount')!.id;
      statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_Conversion_Host',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Label: 'Row 1' } }],
      });
      hostRecordId = host.records[0].id;

      lookupField = await createField(host.id, {
        name: 'Total Amount',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should recalc when expression updates via convertField', async () => {
      const initial = await getRecord(host.id, hostRecordId);
      expect(initial.fields[lookupField.id]).toEqual(12);

      lookupField = await convertField(host.id, lookupField.id, {
        name: lookupField.name,
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'max({values})',
        },
      } as IFieldRo);

      const afterExpressionChange = await getRecord(host.id, hostRecordId);
      expect(afterExpressionChange.fields[lookupField.id]).toEqual(6);
    });

    it('should respect updated filters and foreign mutations', async () => {
      const statusFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: 'Active',
          },
        ],
      } as any;

      lookupField = await convertField(host.id, lookupField.id, {
        name: 'Active Total Amount',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
          filter: statusFilter,
        },
      } as IFieldRo);

      const afterFilter = await getRecord(host.id, hostRecordId);
      expect(afterFilter.fields[lookupField.id]).toEqual(6);

      await updateRecordByApi(foreign.id, foreign.records[2].id, statusId, 'Active');
      const afterStatusChange = await getRecord(host.id, hostRecordId);
      expect(afterStatusChange.fields[lookupField.id]).toEqual(12);

      await updateRecordByApi(foreign.id, foreign.records[0].id, amountId, 7);
      const afterAmountChange = await getRecord(host.id, hostRecordId);
      expect(afterAmountChange.fields[lookupField.id]).toEqual(17);

      await deleteField(foreign.id, statusId);
      const hostFields = await getFields(host.id);
      const erroredField = hostFields.find((field) => field.id === lookupField.id)!;
      expect(erroredField.hasError).toBe(true);
    });
  });

  describe('interoperability with standard lookup fields', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let consumer: ITableFullVo;
    let foreignAmountFieldId: string;
    let referenceLookupField: IFieldVo;
    let consumerLinkField: IFieldVo;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'RefLookup_Nested_Foreign',
        fields: [{ name: 'Amount', type: FieldType.Number } as IFieldRo],
        records: [
          { fields: { Amount: 70 } },
          { fields: { Amount: 20 } },
          { fields: { Amount: 40 } },
        ],
      });
      foreignAmountFieldId = foreign.fields.find((f) => f.name === 'Amount')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_Nested_Host',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Label: 'Totals' } }],
      });

      referenceLookupField = await createField(host.id, {
        name: 'Category Amount Total',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: foreignAmountFieldId,
          expression: 'sum({values})',
        },
      } as IFieldRo);

      consumer = await createTable(baseId, {
        name: 'RefLookup_Nested_Consumer',
        fields: [{ name: 'Owner', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Owner: 'Team A' } }],
      });

      consumerLinkField = await createField(consumer.id, {
        name: 'LinkHost',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: host.id,
        },
      } as IFieldRo);

      await updateRecordByApi(consumer.id, consumer.records[0].id, consumerLinkField.id, {
        id: host.records[0].id,
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, consumer.id);
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('rejects creating a standard lookup targeting a reference lookup field', async () => {
      const hostRecord = await getRecord(host.id, host.records[0].id);
      expect(hostRecord.fields[referenceLookupField.id]).toEqual(130);

      await expect(
        createField(consumer.id, {
          name: 'Lookup Category Total',
          type: FieldType.ReferenceLookup,
          isLookup: true,
          lookupOptions: {
            foreignTableId: host.id,
            linkFieldId: consumerLinkField.id,
            lookupFieldId: referenceLookupField.id,
          } as ILookupOptionsRo,
        } as IFieldRo)
      ).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('reference lookup targeting derived fields', () => {
    let suppliers: ITableFullVo;
    let products: ITableFullVo;
    let host: ITableFullVo;
    let supplierRatingId: string;
    let linkToSupplierField: IFieldVo;
    let supplierRatingLookup: IFieldVo;
    let supplierRatingRollup: IFieldVo;
    let referenceLookupMax: IFieldVo;
    let referenceRollupSum: IFieldVo;
    let referenceLinkCount: IFieldVo;

    beforeAll(async () => {
      suppliers = await createTable(baseId, {
        name: 'RefLookup_Supplier',
        fields: [
          { name: 'SupplierName', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Rating', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { SupplierName: 'Supplier A', Rating: 5 } },
          { fields: { SupplierName: 'Supplier B', Rating: 4 } },
        ],
      });
      supplierRatingId = suppliers.fields.find((f) => f.name === 'Rating')!.id;

      products = await createTable(baseId, {
        name: 'RefLookup_Product',
        fields: [
          { name: 'ProductName', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { ProductName: 'Laptop', Category: 'Hardware' } },
          { fields: { ProductName: 'Mouse', Category: 'Hardware' } },
          { fields: { ProductName: 'Subscription', Category: 'Software' } },
        ],
      });

      linkToSupplierField = await createField(products.id, {
        name: 'Supplier Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: suppliers.id,
        },
      } as IFieldRo);

      await updateRecordByApi(products.id, products.records[0].id, linkToSupplierField.id, {
        id: suppliers.records[0].id,
      });
      await updateRecordByApi(products.id, products.records[1].id, linkToSupplierField.id, {
        id: suppliers.records[1].id,
      });
      await updateRecordByApi(products.id, products.records[2].id, linkToSupplierField.id, {
        id: suppliers.records[1].id,
      });

      supplierRatingLookup = await createField(products.id, {
        name: 'Supplier Rating Lookup',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: suppliers.id,
          linkFieldId: linkToSupplierField.id,
          lookupFieldId: supplierRatingId,
        } as ILookupOptionsRo,
      } as IFieldRo);

      supplierRatingRollup = await createField(products.id, {
        name: 'Supplier Rating Sum',
        type: FieldType.Rollup,
        lookupOptions: {
          foreignTableId: suppliers.id,
          linkFieldId: linkToSupplierField.id,
          lookupFieldId: supplierRatingId,
        } as ILookupOptionsRo,
        options: {
          expression: 'sum({values})',
        },
      } as IFieldRo);

      host = await createTable(baseId, {
        name: 'RefLookup_Derived_Host',
        fields: [{ name: 'Summary', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Summary: 'Global' } }],
      });

      referenceLookupMax = await createField(host.id, {
        name: 'Supplier Rating Max (Lookup)',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingLookup.id,
          expression: 'max({values})',
        },
      } as IFieldRo);

      referenceRollupSum = await createField(host.id, {
        name: 'Supplier Rating Total (Rollup)',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingRollup.id,
          expression: 'sum({values})',
        },
      } as IFieldRo);

      referenceLinkCount = await createField(host.id, {
        name: 'Linked Supplier Count',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: products.id,
          lookupFieldId: linkToSupplierField.id,
          expression: 'count({values})',
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, products.id);
      await permanentDeleteTable(baseId, suppliers.id);
    });

    it('tracks dependencies when reference lookup targets derived fields', async () => {
      const initialHostFields = await getFields(host.id);
      const initialLookupMax = initialHostFields.find(
        (f) => f.id === referenceLookupMax.id
      )! as IFieldVo;
      const initialRollupSum = initialHostFields.find(
        (f) => f.id === referenceRollupSum.id
      )! as IFieldVo;
      const initialLinkCount = initialHostFields.find(
        (f) => f.id === referenceLinkCount.id
      )! as IFieldVo;

      expect(initialLookupMax.hasError).toBeFalsy();
      expect(initialRollupSum.hasError).toBeFalsy();
      expect(initialLinkCount.hasError).toBeFalsy();

      await deleteField(products.id, supplierRatingLookup.id);
      const afterLookupDelete = await getFields(host.id);
      expect(afterLookupDelete.find((f) => f.id === referenceLookupMax.id)?.hasError).toBe(true);

      await deleteField(products.id, supplierRatingRollup.id);
      const afterRollupDelete = await getFields(host.id);
      expect(afterRollupDelete.find((f) => f.id === referenceRollupSum.id)?.hasError).toBe(true);

      await deleteField(products.id, linkToSupplierField.id);
      const afterLinkDelete = await getFields(host.id);
      expect(afterLinkDelete.find((f) => f.id === referenceLinkCount.id)?.hasError).toBe(true);
    });
  });

  describe('reference lookup aggregating formula fields', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let referenceLookupField: IFieldVo;
    let baseFieldId: string;
    let taxFieldId: string;
    let totalFormulaFieldId: string;
    let categoryFieldId: string;
    let hostCategoryFieldId: string;
    let hardwareHostRecordId: string;
    let softwareHostRecordId: string;

    beforeAll(async () => {
      baseFieldId = generateFieldId();
      taxFieldId = generateFieldId();
      totalFormulaFieldId = generateFieldId();

      const baseField: IFieldRo = {
        id: baseFieldId,
        name: 'Base',
        type: FieldType.Number,
      };
      const taxField: IFieldRo = {
        id: taxFieldId,
        name: 'Tax',
        type: FieldType.Number,
      };
      const totalFormulaField: IFieldRo = {
        id: totalFormulaFieldId,
        name: 'Total',
        type: FieldType.Formula,
        options: {
          expression: `{${baseFieldId}} + {${taxFieldId}}`,
        },
      } as IFieldRo;

      foreign = await createTable(baseId, {
        name: 'RefLookup_Formula_Foreign',
        fields: [
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
          baseField,
          taxField,
          totalFormulaField,
        ],
        records: [
          { fields: { Category: 'Hardware', Base: 100, Tax: 10 } },
          { fields: { Category: 'Software', Base: 50, Tax: 5 } },
        ],
      });
      categoryFieldId = foreign.fields.find((f) => f.name === 'Category')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_Formula_Host',
        fields: [{ name: 'CategoryFilter', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { CategoryFilter: 'Hardware' } },
          { fields: { CategoryFilter: 'Software' } },
        ],
      });
      hostCategoryFieldId = host.fields.find((f) => f.name === 'CategoryFilter')!.id;
      hardwareHostRecordId = host.records[0].id;
      softwareHostRecordId = host.records[1].id;

      const categoryMatchFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: hostCategoryFieldId },
          },
        ],
      } as any;

      referenceLookupField = await createField(host.id, {
        name: 'Total Formula Sum',
        type: FieldType.ReferenceLookup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: totalFormulaFieldId,
          expression: 'array_join({values})',
          filter: categoryMatchFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('aggregates formula results and reacts to updates', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareRecord = records.records.find((record) => record.id === hardwareHostRecordId)!;
      const softwareRecord = records.records.find((record) => record.id === softwareHostRecordId)!;

      expect(hardwareRecord.fields[referenceLookupField.id]).toEqual('110');
      expect(softwareRecord.fields[referenceLookupField.id]).toEqual('55');

      await updateRecordByApi(foreign.id, foreign.records[0].id, baseFieldId, 120);

      const updatedHardware = await getRecord(host.id, hardwareHostRecordId);
      expect(updatedHardware.fields[referenceLookupField.id]).toEqual('130');

      const updatedSoftware = await getRecord(host.id, softwareHostRecordId);
      expect(updatedSoftware.fields[referenceLookupField.id]).toEqual('55');
    });
  });
});
