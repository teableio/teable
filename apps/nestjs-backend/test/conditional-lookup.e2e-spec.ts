/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IFilter, ILookupOptionsRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteField,
  getRecord,
  getField,
  getFields,
  getRecords,
  initApp,
  updateRecordByApi,
  permanentDeleteTable,
  createBase,
  deleteBase,
} from './utils/init-app';

describe('OpenAPI Conditional Lookup field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('basic text filter lookup', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let titleId: string;
    let statusId: string;
    let statusFilterId: string;
    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText, options: {} } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', Status: 'Active' } },
          { fields: { Title: 'Beta', Status: 'Active' } },
          { fields: { Title: 'Gamma', Status: 'Closed' } },
        ],
      });
      titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
      statusId = foreign.fields.find((field) => field.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText, options: {} } as IFieldRo],
        records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Closed' } }],
      });
      statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;

      const statusMatchFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: statusFilterId },
          },
        ],
      };

      lookupField = await createField(host.id, {
        name: 'Matching Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter: statusMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should expose conditional lookup metadata', async () => {
      const fields = await getFields(host.id);
      const retrieved = fields.find((field) => field.id === lookupField.id)!;
      expect(retrieved.isLookup).toBe(true);
      expect(retrieved.isConditionalLookup).toBe(true);
      expect(retrieved.lookupOptions).toMatchObject({
        foreignTableId: foreign.id,
        lookupFieldId: titleId,
      });

      const fieldDetail = await getField(host.id, lookupField.id);
      expect(fieldDetail.id).toBe(lookupField.id);
      expect(fieldDetail.lookupOptions).toMatchObject({
        foreignTableId: foreign.id,
        lookupFieldId: titleId,
        filter: expect.objectContaining({ conjunction: 'and' }),
      });
    });

    it('should resolve filtered lookup values for host records', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const activeRecord = records.records.find((record) => record.id === host.records[0].id)!;
      const closedRecord = records.records.find((record) => record.id === host.records[1].id)!;

      expect(activeRecord.fields[lookupField.id]).toEqual(['Alpha', 'Beta']);
      expect(closedRecord.fields[lookupField.id]).toEqual(['Gamma']);
    });
  });

  describe('filter scenarios', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let categoryTitlesField: IFieldVo;
    let dynamicActiveAmountField: IFieldVo;
    let highValueAmountField: IFieldVo;
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
        name: 'ConditionalLookup_Filter_Foreign',
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
        name: 'ConditionalLookup_Filter_Host',
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

      const categoryFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryFieldId },
          },
        ],
      };

      categoryTitlesField = await createField(host.id, {
        name: 'Category Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: foreign.fields.find((f) => f.name === 'Title')!.id,
          filter: categoryFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const dynamicActiveFilter: IFilter = {
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
      };

      dynamicActiveAmountField = await createField(host.id, {
        name: 'Dynamic Active Amounts',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          filter: dynamicActiveFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const highValueActiveFilter: IFilter = {
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
      };

      highValueAmountField = await createField(host.id, {
        name: 'High Value Active Amounts',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          filter: highValueActiveFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should recalc lookup values when host filter field changes', async () => {
      const baseline = await getRecord(host.id, hardwareRecordId);
      expect(baseline.fields[categoryTitlesField.id]).toEqual(['Laptop', 'Mouse']);

      await updateRecordByApi(host.id, hardwareRecordId, categoryFieldId, 'Software');
      const updated = await getRecord(host.id, hardwareRecordId);
      expect(updated.fields[categoryTitlesField.id]).toEqual(['Subscription', 'Upgrade']);

      await updateRecordByApi(host.id, hardwareRecordId, categoryFieldId, 'Hardware');
      const restored = await getRecord(host.id, hardwareRecordId);
      expect(restored.fields[categoryTitlesField.id]).toEqual(['Laptop', 'Mouse']);
    });

    it('should apply field-referenced numeric filters', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareRecord = records.records.find((record) => record.id === hardwareRecordId)!;
      const softwareRecord = records.records.find((record) => record.id === softwareRecordId)!;
      const servicesRecord = records.records.find((record) => record.id === servicesRecordId)!;

      expect(hardwareRecord.fields[dynamicActiveAmountField.id]).toEqual([70]);
      expect(softwareRecord.fields[dynamicActiveAmountField.id]).toEqual([80]);
      expect(servicesRecord.fields[dynamicActiveAmountField.id]).toEqual([15]);
    });

    it('should support multi-condition filters with static thresholds', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareRecord = records.records.find((record) => record.id === hardwareRecordId)!;
      const softwareRecord = records.records.find((record) => record.id === softwareRecordId)!;
      const servicesRecord = records.records.find((record) => record.id === servicesRecordId)!;

      expect(hardwareRecord.fields[highValueAmountField.id]).toEqual([70]);
      expect(softwareRecord.fields[highValueAmountField.id]).toEqual([80]);
      expect(servicesRecord.fields[highValueAmountField.id] ?? []).toEqual([]);
    });

    it('should recompute when host numeric thresholds change', async () => {
      const original = await getRecord(host.id, servicesRecordId);
      expect(original.fields[dynamicActiveAmountField.id]).toEqual([15]);

      await updateRecordByApi(host.id, servicesRecordId, minimumAmountFieldId, 50);
      const raisedThreshold = await getRecord(host.id, servicesRecordId);
      expect(raisedThreshold.fields[dynamicActiveAmountField.id] ?? []).toEqual([]);

      await updateRecordByApi(host.id, servicesRecordId, minimumAmountFieldId, 10);
      const reset = await getRecord(host.id, servicesRecordId);
      expect(reset.fields[dynamicActiveAmountField.id]).toEqual([15]);
    });
  });

  describe('date field reference filters', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let taskId: string;
    let dueDateId: string;
    let hoursId: string;
    let targetDateId: string;
    let onTargetTasksField: IFieldVo;
    let afterTargetHoursField: IFieldVo;
    let beforeTargetHoursField: IFieldVo;
    let onOrBeforeTasksField: IFieldVo;
    let onOrAfterTasksField: IFieldVo;
    let onOrAfterDueDateField: IFieldVo;
    let targetTenRecordId: string;
    let targetElevenRecordId: string;
    let targetThirteenRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Date_Foreign',
        fields: [
          { name: 'Task', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Due Date', type: FieldType.Date } as IFieldRo,
          { name: 'Hours', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Task: 'Spec Draft', 'Due Date': '2024-09-10', Hours: 5 } },
          { fields: { Task: 'Review', 'Due Date': '2024-09-11', Hours: 3 } },
          { fields: { Task: 'Finalize', 'Due Date': '2024-09-12', Hours: 7 } },
        ],
      });

      taskId = foreign.fields.find((f) => f.name === 'Task')!.id;
      dueDateId = foreign.fields.find((f) => f.name === 'Due Date')!.id;
      hoursId = foreign.fields.find((f) => f.name === 'Hours')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Date_Host',
        fields: [{ name: 'Target Date', type: FieldType.Date } as IFieldRo],
        records: [
          { fields: { 'Target Date': '2024-09-10' } },
          { fields: { 'Target Date': '2024-09-11' } },
          { fields: { 'Target Date': '2024-09-13' } },
        ],
      });

      targetDateId = host.fields.find((f) => f.name === 'Target Date')!.id;
      targetTenRecordId = host.records[0].id;
      targetElevenRecordId = host.records[1].id;
      targetThirteenRecordId = host.records[2].id;

      await updateRecordByApi(host.id, targetTenRecordId, targetDateId, '2024-09-10T08:00:00.000Z');
      await updateRecordByApi(
        host.id,
        targetElevenRecordId,
        targetDateId,
        '2024-09-11T12:30:00.000Z'
      );
      await updateRecordByApi(
        host.id,
        targetThirteenRecordId,
        targetDateId,
        '2024-09-13T16:45:00.000Z'
      );

      const onTargetFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'is',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      };

      onTargetTasksField = await createField(host.id, {
        name: 'On Target Tasks',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: taskId,
          filter: onTargetFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const afterTargetFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isAfter',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      };

      afterTargetHoursField = await createField(host.id, {
        name: 'After Target Hours',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: hoursId,
          filter: afterTargetFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const beforeTargetFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isBefore',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      };

      beforeTargetHoursField = await createField(host.id, {
        name: 'Before Target Hours',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: hoursId,
          filter: beforeTargetFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const onOrBeforeFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isOnOrBefore',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      };

      onOrBeforeTasksField = await createField(host.id, {
        name: 'On Or Before Tasks',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: taskId,
          filter: onOrBeforeFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const onOrAfterFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isOnOrAfter',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      };

      onOrAfterTasksField = await createField(host.id, {
        name: 'On Or After Tasks',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: taskId,
          filter: onOrAfterFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      onOrAfterDueDateField = await createField(host.id, {
        name: 'On Or After Due Dates',
        type: FieldType.Date,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: dueDateId,
          filter: onOrAfterFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should evaluate date comparisons referencing host fields', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const targetTen = records.records.find((record) => record.id === targetTenRecordId)!;
      const targetEleven = records.records.find((record) => record.id === targetElevenRecordId)!;
      const targetThirteen = records.records.find(
        (record) => record.id === targetThirteenRecordId
      )!;

      expect(targetTen.fields[onTargetTasksField.id]).toEqual(['Spec Draft']);
      expect(targetTen.fields[afterTargetHoursField.id]).toEqual([3, 7]);
      expect(targetTen.fields[beforeTargetHoursField.id] ?? []).toEqual([]);
      expect(targetTen.fields[onOrBeforeTasksField.id]).toEqual(['Spec Draft']);
      expect(targetTen.fields[onOrAfterTasksField.id]).toEqual([
        'Spec Draft',
        'Review',
        'Finalize',
      ]);

      expect(targetEleven.fields[onTargetTasksField.id]).toEqual(['Review']);
      expect(targetEleven.fields[afterTargetHoursField.id]).toEqual([7]);
      expect(targetEleven.fields[beforeTargetHoursField.id]).toEqual([5]);
      expect(targetEleven.fields[onOrBeforeTasksField.id]).toEqual(['Spec Draft', 'Review']);
      expect(targetEleven.fields[onOrAfterTasksField.id]).toEqual(['Review', 'Finalize']);

      expect(targetThirteen.fields[onTargetTasksField.id] ?? []).toEqual([]);
      expect(targetThirteen.fields[afterTargetHoursField.id] ?? []).toEqual([]);
      expect(targetThirteen.fields[beforeTargetHoursField.id]).toEqual([5, 3, 7]);
      expect(targetThirteen.fields[onOrBeforeTasksField.id]).toEqual([
        'Spec Draft',
        'Review',
        'Finalize',
      ]);
      expect(targetThirteen.fields[onOrAfterTasksField.id] ?? []).toEqual([]);
    });

    it('should reuse source field formatting for date lookups', async () => {
      const hostFieldDetail = await getField(host.id, onOrAfterDueDateField.id);
      const foreignFieldDetail = await getField(foreign.id, dueDateId);
      expect(hostFieldDetail.options).toEqual(foreignFieldDetail.options);
    });
  });

  describe('conditional lookup targeting derived fields', () => {
    let suppliers: ITableFullVo;
    let products: ITableFullVo;
    let host: ITableFullVo;
    let supplierRatingId: string;
    let linkToSupplierField: IFieldVo;
    let supplierRatingLookup: IFieldVo;
    let supplierRatingRollup: IFieldVo;
    let supplierRatingTotalFormula: IFieldVo;
    let ratingValuesLookupField: IFieldVo;
    let hostProductsLinkField: IFieldVo;

    beforeAll(async () => {
      suppliers = await createTable(baseId, {
        name: 'ConditionalLookup_Supplier',
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
        name: 'ConditionalLookup_Product',
        fields: [{ name: 'ProductName', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { ProductName: 'Laptop' } },
          { fields: { ProductName: 'Mouse' } },
          { fields: { ProductName: 'Subscription' } },
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
        name: 'ConditionalLookup_Derived_Host',
        fields: [{ name: 'Summary', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Summary: 'Global' } }],
      });

      hostProductsLinkField = await createField(host.id, {
        name: 'Products Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: products.id,
        },
      } as IFieldRo);

      await updateRecordByApi(
        host.id,
        host.records[0].id,
        hostProductsLinkField.id,
        products.records.map((record) => ({ id: record.id }))
      );

      const ratingPresentFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: supplierRatingLookup.id,
            operator: 'isNotEmpty',
            value: null,
          },
        ],
      };

      ratingValuesLookupField = await createField(host.id, {
        name: 'Supplier Ratings (Lookup)',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingLookup.id,
          filter: ratingPresentFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, products.id);
      await permanentDeleteTable(baseId, suppliers.id);
    });

    it('aggregates lookup values from derived fields', async () => {
      const hostRecord = await getRecord(host.id, host.records[0].id);
      expect(hostRecord.fields[ratingValuesLookupField.id]).toEqual([5, 4, 4]);
    });

    it('marks lookup dependencies as errored when source fields are removed', async () => {
      await deleteField(products.id, supplierRatingLookup.id);
      const afterLookupDelete = await getFields(host.id);
      expect(afterLookupDelete.find((f) => f.id === ratingValuesLookupField.id)?.hasError).toBe(
        true
      );
    });
  });

  describe('conditional lookup across bases', () => {
    let foreignBaseId: string;
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let crossBaseLookupField: IFieldVo;
    let foreignCategoryId: string;
    let foreignAmountId: string;
    let hostCategoryId: string;
    let hardwareRecordId: string;
    let softwareRecordId: string;

    beforeAll(async () => {
      const spaceId = globalThis.testConfig.spaceId;
      const createdBase = await createBase({ spaceId, name: 'Conditional Lookup Cross Base' });
      foreignBaseId = createdBase.id;

      foreign = await createTable(foreignBaseId, {
        name: 'ConditionalLookup_CrossBase_Foreign',
        fields: [
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Category: 'Hardware', Amount: 100 } },
          { fields: { Category: 'Hardware', Amount: 50 } },
          { fields: { Category: 'Software', Amount: 70 } },
        ],
      });
      foreignCategoryId = foreign.fields.find((f) => f.name === 'Category')!.id;
      foreignAmountId = foreign.fields.find((f) => f.name === 'Amount')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_CrossBase_Host',
        fields: [{ name: 'CategoryMatch', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { CategoryMatch: 'Hardware' } },
          { fields: { CategoryMatch: 'Software' } },
        ],
      });
      hostCategoryId = host.fields.find((f) => f.name === 'CategoryMatch')!.id;
      hardwareRecordId = host.records[0].id;
      softwareRecordId = host.records[1].id;

      const categoryFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: foreignCategoryId,
            operator: 'is',
            value: { type: 'field', fieldId: hostCategoryId },
          },
        ],
      };

      crossBaseLookupField = await createField(host.id, {
        name: 'Cross Base Amounts',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          baseId: foreignBaseId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignAmountId,
          filter: categoryFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(foreignBaseId, foreign.id);
      await deleteBase(foreignBaseId);
    });

    it('aggregates values when referencing a foreign base', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareRecord = records.records.find((record) => record.id === hardwareRecordId)!;
      const softwareRecord = records.records.find((record) => record.id === softwareRecordId)!;

      expect(hardwareRecord.fields[crossBaseLookupField.id]).toEqual([100, 50]);
      expect(softwareRecord.fields[crossBaseLookupField.id]).toEqual([70]);
    });
  });
});
