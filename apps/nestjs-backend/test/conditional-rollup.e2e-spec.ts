/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  ILookupOptionsRo,
  IConditionalRollupFieldOptions,
} from '@teable/core';
import {
  CellValueType,
  Colors,
  DbFieldType,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  Relationship,
  generateFieldId,
  isGreater,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createBase,
  createField,
  convertField,
  createTable,
  deleteBase,
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

describe('OpenAPI Conditional Rollup field (e2e)', () => {
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
        type: FieldType.ConditionalRollup,
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

    it('should expose conditional rollup via table and field endpoints', async () => {
      const tableInfo = await getTable(baseId, host.id);
      expect(tableInfo.id).toBe(host.id);

      const fields = await getFields(host.id);
      const retrieved = fields.find((field) => field.id === lookupField.id)!;
      expect(retrieved.type).toBe(FieldType.ConditionalRollup);
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
        type: FieldType.ConditionalRollup,
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
        type: FieldType.ConditionalRollup,
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
        type: FieldType.ConditionalRollup,
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

    it('should filter host records by conditional rollup values', async () => {
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

  describe('date field reference filters', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let dueDateId: string;
    let amountId: string;
    let targetDateId: string;
    let onTargetCountField: IFieldVo;
    let afterTargetSumField: IFieldVo;
    let beforeTargetSumField: IFieldVo;
    let onOrBeforeTargetCountField: IFieldVo;
    let onOrAfterTargetCountField: IFieldVo;
    let targetTenRecordId: string;
    let targetElevenRecordId: string;
    let targetThirteenRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Date_Foreign',
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

      dueDateId = foreign.fields.find((field) => field.name === 'Due Date')!.id;
      amountId = foreign.fields.find((field) => field.name === 'Hours')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalRollup_Date_Host',
        fields: [{ name: 'Target Date', type: FieldType.Date } as IFieldRo],
        records: [
          { fields: { 'Target Date': '2024-09-10' } },
          { fields: { 'Target Date': '2024-09-11' } },
          { fields: { 'Target Date': '2024-09-13' } },
        ],
      });

      targetDateId = host.fields.find((field) => field.name === 'Target Date')!.id;
      targetTenRecordId = host.records[0].id;
      targetElevenRecordId = host.records[1].id;
      targetThirteenRecordId = host.records[2].id;

      await updateRecordByApi(host.id, targetTenRecordId, targetDateId, '2024-09-10T12:34:56.000Z');
      await updateRecordByApi(
        host.id,
        targetElevenRecordId,
        targetDateId,
        '2024-09-11T12:50:00.000Z'
      );
      await updateRecordByApi(
        host.id,
        targetThirteenRecordId,
        targetDateId,
        '2024-09-13T12:15:00.000Z'
      );

      const onTargetFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'is',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      } as any;

      onTargetCountField = await createField(host.id, {
        name: 'On Target Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: onTargetFilter,
        },
      } as IFieldRo);

      const afterTargetFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isAfter',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      } as any;

      afterTargetSumField = await createField(host.id, {
        name: 'After Target Hours',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
          filter: afterTargetFilter,
        },
      } as IFieldRo);

      const beforeTargetFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isBefore',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      } as any;

      beforeTargetSumField = await createField(host.id, {
        name: 'Before Target Hours',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
          filter: beforeTargetFilter,
        },
      } as IFieldRo);

      const onOrBeforeFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isOnOrBefore',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      } as any;

      onOrBeforeTargetCountField = await createField(host.id, {
        name: 'On Or Before Target Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: onOrBeforeFilter,
        },
      } as IFieldRo);

      const onOrAfterFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: dueDateId,
            operator: 'isOnOrAfter',
            value: { type: 'field', fieldId: targetDateId },
          },
        ],
      } as any;

      onOrAfterTargetCountField = await createField(host.id, {
        name: 'On Or After Target Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: onOrAfterFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should aggregate by matching host date fields', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const targetTen = records.records.find((record) => record.id === targetTenRecordId)!;
      const targetEleven = records.records.find((record) => record.id === targetElevenRecordId)!;
      const targetThirteen = records.records.find(
        (record) => record.id === targetThirteenRecordId
      )!;

      expect(targetTen.fields[onTargetCountField.id]).toEqual(1);
      expect(targetEleven.fields[onTargetCountField.id]).toEqual(1);
      expect(targetThirteen.fields[onTargetCountField.id]).toEqual(0);
    });

    it('should support field-referenced date comparisons for ranges', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const targetTen = records.records.find((record) => record.id === targetTenRecordId)!;
      const targetEleven = records.records.find((record) => record.id === targetElevenRecordId)!;
      const targetThirteen = records.records.find(
        (record) => record.id === targetThirteenRecordId
      )!;

      expect(targetTen.fields[afterTargetSumField.id]).toEqual(10);
      expect(targetEleven.fields[afterTargetSumField.id]).toEqual(7);
      expect(targetThirteen.fields[afterTargetSumField.id]).toEqual(0);
    });

    it('should evaluate before/after comparisons using host fields', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const targetTen = records.records.find((record) => record.id === targetTenRecordId)!;
      const targetEleven = records.records.find((record) => record.id === targetElevenRecordId)!;
      const targetThirteen = records.records.find(
        (record) => record.id === targetThirteenRecordId
      )!;

      expect(targetTen.fields[beforeTargetSumField.id]).toEqual(0);
      expect(targetEleven.fields[beforeTargetSumField.id]).toEqual(5);
      expect(targetThirteen.fields[beforeTargetSumField.id]).toEqual(15);

      expect(targetTen.fields[onOrAfterTargetCountField.id]).toEqual(3);
      expect(targetEleven.fields[onOrAfterTargetCountField.id]).toEqual(2);
      expect(targetThirteen.fields[onOrAfterTargetCountField.id]).toEqual(0);
    });

    it('should aggregate inclusive comparisons with host fields', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const targetTen = records.records.find((record) => record.id === targetTenRecordId)!;
      const targetEleven = records.records.find((record) => record.id === targetElevenRecordId)!;
      const targetThirteen = records.records.find(
        (record) => record.id === targetThirteenRecordId
      )!;

      expect(targetTen.fields[onOrBeforeTargetCountField.id]).toEqual(1);
      expect(targetEleven.fields[onOrBeforeTargetCountField.id]).toEqual(2);
      expect(targetThirteen.fields[onOrBeforeTargetCountField.id]).toEqual(3);
    });
  });

  describe('boolean field reference filters', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let statusFieldId: string;
    let hostFlagFieldId: string;
    let matchCountField: IFieldVo;
    let hostTrueRecordId: string;
    let hostFalseRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Bool_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'IsActive', type: FieldType.Checkbox } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', IsActive: true } },
          { fields: { Title: 'Beta', IsActive: false } },
          { fields: { Title: 'Gamma', IsActive: true } },
        ],
      });

      statusFieldId = foreign.fields.find((field) => field.name === 'IsActive')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalRollup_Bool_Host',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'TargetActive', type: FieldType.Checkbox } as IFieldRo,
        ],
        records: [
          { fields: { Name: 'Should Match True', TargetActive: true } },
          { fields: { Name: 'Should Match False' } },
        ],
      });

      hostFlagFieldId = host.fields.find((field) => field.name === 'TargetActive')!.id;
      hostTrueRecordId = host.records[0].id;
      hostFalseRecordId = host.records[1].id;

      const matchFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: hostFlagFieldId },
          },
        ],
      } as any;

      matchCountField = await createField(host.id, {
        name: 'Matching Actives',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: statusFieldId,
          expression: 'count({values})',
          filter: matchFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should aggregate based on host boolean field references', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hostTrueRecord = records.records.find((record) => record.id === hostTrueRecordId)!;
      const hostFalseRecord = records.records.find((record) => record.id === hostFalseRecordId)!;

      expect(hostTrueRecord.fields[matchCountField.id]).toEqual(2);
      expect(hostFalseRecord.fields[matchCountField.id]).toEqual(0);
    });

    it('should react to host boolean changes', async () => {
      await updateRecordByApi(host.id, hostTrueRecordId, hostFlagFieldId, null);
      await updateRecordByApi(host.id, hostFalseRecordId, hostFlagFieldId, true);

      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hostTrueRecord = records.records.find((record) => record.id === hostTrueRecordId)!;
      const hostFalseRecord = records.records.find((record) => record.id === hostFalseRecordId)!;

      expect(hostTrueRecord.fields[matchCountField.id]).toEqual(0);
      expect(hostFalseRecord.fields[matchCountField.id]).toEqual(2);
    });
  });

  describe('field and literal comparison matrix', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let fieldDrivenCountField: IFieldVo;
    let literalMixCountField: IFieldVo;
    let quantityWindowSumField: IFieldVo;
    let categoryId: string;
    let amountId: string;
    let quantityId: string;
    let statusId: string;
    let categoryPickId: string;
    let amountFloorId: string;
    let quantityMaxId: string;
    let statusTargetId: string;
    let hostHardwareActiveId: string;
    let hostOfficeActiveId: string;
    let hostHardwareInactiveId: string;
    let foreignLaptopId: string;
    let foreignMonitorId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'RefLookup_FieldMatrix_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          { name: 'Quantity', type: FieldType.Number } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Title: 'Laptop',
              Category: 'Hardware',
              Amount: 80,
              Quantity: 5,
              Status: 'Active',
            },
          },
          {
            fields: {
              Title: 'Monitor',
              Category: 'Hardware',
              Amount: 20,
              Quantity: 2,
              Status: 'Inactive',
            },
          },
          {
            fields: {
              Title: 'Subscription',
              Category: 'Office',
              Amount: 60,
              Quantity: 10,
              Status: 'Active',
            },
          },
          {
            fields: {
              Title: 'Upgrade',
              Category: 'Office',
              Amount: 35,
              Quantity: 3,
              Status: 'Active',
            },
          },
        ],
      });

      categoryId = foreign.fields.find((f) => f.name === 'Category')!.id;
      amountId = foreign.fields.find((f) => f.name === 'Amount')!.id;
      quantityId = foreign.fields.find((f) => f.name === 'Quantity')!.id;
      statusId = foreign.fields.find((f) => f.name === 'Status')!.id;
      foreignLaptopId = foreign.records.find((record) => record.fields.Title === 'Laptop')!.id;
      foreignMonitorId = foreign.records.find((record) => record.fields.Title === 'Monitor')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_FieldMatrix_Host',
        fields: [
          { name: 'CategoryPick', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'AmountFloor', type: FieldType.Number } as IFieldRo,
          { name: 'QuantityMax', type: FieldType.Number } as IFieldRo,
          { name: 'StatusTarget', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          {
            fields: {
              CategoryPick: 'Hardware',
              AmountFloor: 60,
              QuantityMax: 10,
              StatusTarget: 'Active',
            },
          },
          {
            fields: {
              CategoryPick: 'Office',
              AmountFloor: 30,
              QuantityMax: 12,
              StatusTarget: 'Active',
            },
          },
          {
            fields: {
              CategoryPick: 'Hardware',
              AmountFloor: 10,
              QuantityMax: 4,
              StatusTarget: 'Inactive',
            },
          },
        ],
      });

      categoryPickId = host.fields.find((f) => f.name === 'CategoryPick')!.id;
      amountFloorId = host.fields.find((f) => f.name === 'AmountFloor')!.id;
      quantityMaxId = host.fields.find((f) => f.name === 'QuantityMax')!.id;
      statusTargetId = host.fields.find((f) => f.name === 'StatusTarget')!.id;
      hostHardwareActiveId = host.records[0].id;
      hostOfficeActiveId = host.records[1].id;
      hostHardwareInactiveId = host.records[2].id;

      const fieldDrivenFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryPickId },
          },
          {
            fieldId: amountId,
            operator: 'isGreaterEqual',
            value: { type: 'field', fieldId: amountFloorId },
          },
          {
            fieldId: statusId,
            operator: 'is',
            value: { type: 'field', fieldId: statusTargetId },
          },
        ],
      } as any;

      fieldDrivenCountField = await createField(host.id, {
        name: 'Field Driven Matches',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: fieldDrivenFilter,
        },
      } as IFieldRo);

      const literalMixFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: 'Hardware',
          },
          {
            fieldId: statusId,
            operator: 'isNot',
            value: { type: 'field', fieldId: statusTargetId },
          },
          {
            fieldId: amountId,
            operator: 'isGreater',
            value: 15,
          },
        ],
      } as any;

      literalMixCountField = await createField(host.id, {
        name: 'Literal Mix Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'count({values})',
          filter: literalMixFilter,
        },
      } as IFieldRo);

      const quantityWindowFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: categoryId,
            operator: 'is',
            value: { type: 'field', fieldId: categoryPickId },
          },
          {
            fieldId: quantityId,
            operator: 'isLessEqual',
            value: { type: 'field', fieldId: quantityMaxId },
          },
        ],
      } as any;

      quantityWindowSumField = await createField(host.id, {
        name: 'Quantity Window Sum',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: quantityId,
          expression: 'sum({values})',
          filter: quantityWindowFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should evaluate field-to-field comparisons across operators', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareActive = records.records.find((record) => record.id === hostHardwareActiveId)!;
      const officeActive = records.records.find((record) => record.id === hostOfficeActiveId)!;
      const hardwareInactive = records.records.find(
        (record) => record.id === hostHardwareInactiveId
      )!;

      expect(hardwareActive.fields[fieldDrivenCountField.id]).toEqual(1);
      expect(officeActive.fields[fieldDrivenCountField.id]).toEqual(2);
      expect(hardwareInactive.fields[fieldDrivenCountField.id]).toEqual(1);
    });

    it('should mix literal and field referenced criteria', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareActive = records.records.find((record) => record.id === hostHardwareActiveId)!;
      const officeActive = records.records.find((record) => record.id === hostOfficeActiveId)!;
      const hardwareInactive = records.records.find(
        (record) => record.id === hostHardwareInactiveId
      )!;

      expect(hardwareActive.fields[literalMixCountField.id]).toEqual(1);
      expect(officeActive.fields[literalMixCountField.id]).toEqual(1);
      expect(hardwareInactive.fields[literalMixCountField.id]).toEqual(1);
    });

    it('should support field referenced numeric windows with aggregations', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareActive = records.records.find((record) => record.id === hostHardwareActiveId)!;
      const officeActive = records.records.find((record) => record.id === hostOfficeActiveId)!;
      const hardwareInactive = records.records.find(
        (record) => record.id === hostHardwareInactiveId
      )!;

      expect(hardwareActive.fields[quantityWindowSumField.id]).toEqual(7);
      expect(officeActive.fields[quantityWindowSumField.id]).toEqual(13);
      expect(hardwareInactive.fields[quantityWindowSumField.id]).toEqual(2);
    });

    it('should recompute when host thresholds change', async () => {
      await updateRecordByApi(host.id, hostHardwareActiveId, amountFloorId, 90);
      const tightened = await getRecord(host.id, hostHardwareActiveId);
      expect(tightened.fields[fieldDrivenCountField.id]).toEqual(0);

      await updateRecordByApi(host.id, hostHardwareActiveId, amountFloorId, 60);
      const restored = await getRecord(host.id, hostHardwareActiveId);
      expect(restored.fields[fieldDrivenCountField.id]).toEqual(1);
    });

    it('should react to foreign table updates referenced by filters', async () => {
      await updateRecordByApi(foreign.id, foreignLaptopId, statusId, 'Inactive');
      const afterStatusChange = await getRecord(host.id, hostHardwareActiveId);
      expect(afterStatusChange.fields[fieldDrivenCountField.id]).toEqual(0);
      expect(afterStatusChange.fields[literalMixCountField.id]).toEqual(2);

      await updateRecordByApi(foreign.id, foreignLaptopId, statusId, 'Active');
      const restored = await getRecord(host.id, hostHardwareActiveId);
      expect(restored.fields[fieldDrivenCountField.id]).toEqual(1);
      expect(restored.fields[literalMixCountField.id]).toEqual(1);

      await updateRecordByApi(foreign.id, foreignMonitorId, quantityId, 4);
      const quantityAdjusted = await getRecord(host.id, hostHardwareInactiveId);
      expect(quantityAdjusted.fields[quantityWindowSumField.id]).toEqual(4);

      await updateRecordByApi(foreign.id, foreignMonitorId, quantityId, 2);
      const quantityRestored = await getRecord(host.id, hostHardwareInactiveId);
      expect(quantityRestored.fields[quantityWindowSumField.id]).toEqual(2);
    });
  });

  describe('advanced operator coverage', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let tierWindowField: IFieldVo;
    let tagAllCountField: IFieldVo;
    let tagNoneCountField: IFieldVo;
    let concatNameField: IFieldVo;
    let uniqueTierField: IFieldVo;
    let compactRatingField: IFieldVo;
    let currencyScoreField: IFieldVo;
    let percentScoreField: IFieldVo;
    let tierId: string;
    let nameId: string;
    let tagsId: string;
    let ratingId: string;
    let scoreId: string;
    let targetTierId: string;
    let minRatingId: string;
    let maxScoreId: string;
    let hostRow1Id: string;
    let hostRow2Id: string;
    let hostRow3Id: string;

    beforeAll(async () => {
      const tierChoices = [
        { id: 'tier-basic', name: 'Basic', color: Colors.Blue },
        { id: 'tier-pro', name: 'Pro', color: Colors.Green },
        { id: 'tier-enterprise', name: 'Enterprise', color: Colors.Orange },
      ];
      const tagChoices = [
        { id: 'tag-urgent', name: 'Urgent', color: Colors.Red },
        { id: 'tag-review', name: 'Review', color: Colors.Blue },
        { id: 'tag-backlog', name: 'Backlog', color: Colors.Purple },
      ];

      foreign = await createTable(baseId, {
        name: 'RefLookup_AdvancedOps_Foreign',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Tier',
            type: FieldType.SingleSelect,
            options: { choices: tierChoices },
          } as IFieldRo,
          {
            name: 'Tags',
            type: FieldType.MultipleSelect,
            options: { choices: tagChoices },
          } as IFieldRo,
          { name: 'IsActive', type: FieldType.Checkbox } as IFieldRo,
          {
            name: 'Rating',
            type: FieldType.Rating,
            options: { icon: 'star', color: 'yellowBright', max: 5 },
          } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Name: 'Alpha',
              Tier: 'Basic',
              Tags: ['Urgent', 'Review'],
              IsActive: true,
              Rating: 4,
              Score: 45,
            },
          },
          {
            fields: {
              Name: 'Beta',
              Tier: 'Pro',
              Tags: ['Review'],
              IsActive: false,
              Rating: 5,
              Score: 80,
            },
          },
          {
            fields: {
              Name: 'Gamma',
              Tier: 'Pro',
              Tags: ['Urgent'],
              IsActive: true,
              Rating: 2,
              Score: 30,
            },
          },
          {
            fields: {
              Name: 'Delta',
              Tier: 'Enterprise',
              Tags: ['Review', 'Backlog'],
              IsActive: true,
              Rating: 4,
              Score: 55,
            },
          },
          {
            fields: {
              Name: 'Epsilon',
              Tier: 'Pro',
              Tags: ['Review'],
              IsActive: true,
              Rating: null,
              Score: 25,
            },
          },
        ],
      });

      nameId = foreign.fields.find((f) => f.name === 'Name')!.id;
      tierId = foreign.fields.find((f) => f.name === 'Tier')!.id;
      tagsId = foreign.fields.find((f) => f.name === 'Tags')!.id;
      ratingId = foreign.fields.find((f) => f.name === 'Rating')!.id;
      scoreId = foreign.fields.find((f) => f.name === 'Score')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_AdvancedOps_Host',
        fields: [
          {
            name: 'TargetTier',
            type: FieldType.SingleSelect,
            options: { choices: tierChoices },
          } as IFieldRo,
          { name: 'MinRating', type: FieldType.Number } as IFieldRo,
          { name: 'MaxScore', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          {
            fields: {
              TargetTier: 'Basic',
              MinRating: 3,
              MaxScore: 60,
            },
          },
          {
            fields: {
              TargetTier: 'Pro',
              MinRating: 4,
              MaxScore: 90,
            },
          },
          {
            fields: {
              TargetTier: 'Enterprise',
              MinRating: 4,
              MaxScore: 70,
            },
          },
        ],
      });

      targetTierId = host.fields.find((f) => f.name === 'TargetTier')!.id;
      minRatingId = host.fields.find((f) => f.name === 'MinRating')!.id;
      maxScoreId = host.fields.find((f) => f.name === 'MaxScore')!.id;
      hostRow1Id = host.records[0].id;
      hostRow2Id = host.records[1].id;
      hostRow3Id = host.records[2].id;

      const tierWindowFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: tierId,
            operator: 'is',
            value: { type: 'field', fieldId: targetTierId },
          },
          {
            fieldId: tagsId,
            operator: 'hasAllOf',
            value: ['Review'],
          },
          {
            fieldId: tagsId,
            operator: 'hasNoneOf',
            value: ['Backlog'],
          },
          {
            fieldId: ratingId,
            operator: 'isGreaterEqual',
            value: { type: 'field', fieldId: minRatingId },
          },
          {
            fieldId: scoreId,
            operator: 'isLessEqual',
            value: { type: 'field', fieldId: maxScoreId },
          },
        ],
      } as any;

      tierWindowField = await createField(host.id, {
        name: 'Tier Window Matches',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'count({values})',
          filter: tierWindowFilter,
        },
      } as IFieldRo);

      tagAllCountField = await createField(host.id, {
        name: 'Tag All Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'count({values})',
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: tagsId,
                operator: 'hasAllOf',
                value: ['Review'],
              },
            ],
          },
        },
      } as IFieldRo);

      tagNoneCountField = await createField(host.id, {
        name: 'Tag None Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'count({values})',
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: tagsId,
                operator: 'hasNoneOf',
                value: ['Backlog'],
              },
            ],
          },
        },
      } as IFieldRo);

      concatNameField = await createField(host.id, {
        name: 'Concatenated Names',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: nameId,
          expression: 'concatenate({values})',
        },
      } as IFieldRo);

      uniqueTierField = await createField(host.id, {
        name: 'Unique Tier List',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: tierId,
          expression: 'array_unique({values})',
        },
      } as IFieldRo);

      compactRatingField = await createField(host.id, {
        name: 'Compact Rating Values',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: ratingId,
          expression: 'array_compact({values})',
        },
      } as IFieldRo);

      currencyScoreField = await createField(host.id, {
        name: 'Currency Score Total',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'sum({values})',
          formatting: {
            type: NumberFormattingType.Currency,
            precision: 1,
            symbol: '¥',
          },
        },
      } as IFieldRo);

      percentScoreField = await createField(host.id, {
        name: 'Percent Score Total',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'sum({values})',
          formatting: {
            type: NumberFormattingType.Percent,
            precision: 2,
          },
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should evaluate combined field-referenced conditions across types', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const row1 = records.records.find((record) => record.id === hostRow1Id)!;
      const row2 = records.records.find((record) => record.id === hostRow2Id)!;
      const row3 = records.records.find((record) => record.id === hostRow3Id)!;

      expect(row1.fields[tierWindowField.id]).toEqual(1);
      expect(row2.fields[tierWindowField.id]).toEqual(1);
      expect(row3.fields[tierWindowField.id]).toEqual(0);
    });

    it('should support concatenate and unique aggregations', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const row1 = records.records.find((record) => record.id === hostRow1Id)!;
      const row2 = records.records.find((record) => record.id === hostRow2Id)!;

      const namesRow1 = (row1.fields[concatNameField.id] as string).split(', ').sort();
      const namesRow2 = (row2.fields[concatNameField.id] as string).split(', ').sort();
      const expectedNames = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].sort();
      expect(namesRow1).toEqual(expectedNames);
      expect(namesRow2).toEqual(expectedNames);

      const uniqueTierList = [...(row1.fields[uniqueTierField.id] as string[])].sort();
      expect(uniqueTierList).toEqual(['Basic', 'Enterprise', 'Pro']);
      expect((row2.fields[uniqueTierField.id] as string[]).sort()).toEqual(uniqueTierList);
    });

    it('should remove null values when compacting arrays', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const row1 = records.records.find((record) => record.id === hostRow1Id)!;

      const compactRatings = row1.fields[compactRatingField.id] as unknown[];
      expect(Array.isArray(compactRatings)).toBe(true);
      expect(compactRatings).toEqual(expect.arrayContaining([4, 5, 2, 4]));
      expect(compactRatings).toHaveLength(4);
      expect(compactRatings).not.toContain(null);
    });

    it('should evaluate multi-select operators with field references', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const row1 = records.records.find((record) => record.id === hostRow1Id)!;
      const row2 = records.records.find((record) => record.id === hostRow2Id)!;
      const row3 = records.records.find((record) => record.id === hostRow3Id)!;

      expect(row1.fields[tagAllCountField.id]).toEqual(4);
      expect(row2.fields[tagAllCountField.id]).toEqual(4);
      expect(row3.fields[tagAllCountField.id]).toEqual(4);

      expect(row1.fields[tagNoneCountField.id]).toEqual(4);
      expect(row2.fields[tagNoneCountField.id]).toEqual(4);
      expect(row3.fields[tagNoneCountField.id]).toEqual(4);
    });

    it('should recompute results when host filters change', async () => {
      await updateRecordByApi(host.id, hostRow1Id, maxScoreId, 40);
      const tightened = await getRecord(host.id, hostRow1Id);
      expect(tightened.fields[tierWindowField.id]).toEqual(0);

      await updateRecordByApi(host.id, hostRow1Id, maxScoreId, 60);
      const restored = await getRecord(host.id, hostRow1Id);
      expect(restored.fields[tierWindowField.id]).toEqual(1);

      await updateRecordByApi(host.id, hostRow2Id, minRatingId, 6);
      const stricter = await getRecord(host.id, hostRow2Id);
      expect(stricter.fields[tierWindowField.id]).toEqual(0);

      await updateRecordByApi(host.id, hostRow2Id, minRatingId, 4);
      const ratingRestored = await getRecord(host.id, hostRow2Id);
      expect(ratingRestored.fields[tierWindowField.id]).toEqual(1);
    });

    it('should respond to foreign changes impacting multi-type comparisons', async () => {
      const baseline = await getRecord(host.id, hostRow2Id);
      expect(baseline.fields[tierWindowField.id]).toEqual(1);

      await updateRecordByApi(foreign.id, foreign.records[1].id, ratingId, 3);
      const lowered = await getRecord(host.id, hostRow2Id);
      expect(lowered.fields[tierWindowField.id]).toEqual(0);

      await updateRecordByApi(foreign.id, foreign.records[1].id, ratingId, 5);
      const reset = await getRecord(host.id, hostRow2Id);
      expect(reset.fields[tierWindowField.id]).toEqual(1);
    });

    it('should persist numeric formatting options', async () => {
      const currencyFieldMeta = await getField(host.id, currencyScoreField.id);
      expect((currencyFieldMeta.options as IConditionalRollupFieldOptions)?.formatting).toEqual({
        type: NumberFormattingType.Currency,
        precision: 1,
        symbol: '¥',
      });

      const percentFieldMeta = await getField(host.id, percentScoreField.id);
      expect((percentFieldMeta.options as IConditionalRollupFieldOptions)?.formatting).toEqual({
        type: NumberFormattingType.Percent,
        precision: 2,
      });

      const record = await getRecord(host.id, hostRow1Id);
      expect(record.fields[currencyScoreField.id]).toEqual(45 + 80 + 30 + 55 + 25);
      expect(record.fields[percentScoreField.id]).toEqual(45 + 80 + 30 + 55 + 25);
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
        type: FieldType.ConditionalRollup,
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
        type: FieldType.ConditionalRollup,
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
        type: FieldType.ConditionalRollup,
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

    it('marks conditional rollup error when aggregation becomes incompatible after foreign conversion', async () => {
      const standaloneLookupField = await createField(host.id, {
        name: 'Standalone Sum',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
        },
      } as IFieldRo);

      const baseline = await getRecord(host.id, hostRecordId);
      expect(baseline.fields[standaloneLookupField.id]).toEqual(17);

      await convertField(foreign.id, amountId, {
        name: 'Amount (Single Select)',
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { name: '2', color: Colors.Blue },
            { name: '4', color: Colors.Green },
            { name: '6', color: Colors.Orange },
          ],
        },
      } as IFieldRo);
      let erroredField: IFieldVo | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        const fieldsAfterConversion = await getFields(host.id);
        erroredField = fieldsAfterConversion.find((field) => field.id === standaloneLookupField.id);
        if (erroredField?.hasError) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(erroredField?.hasError).toBe(true);
    });
  });

  describe('datetime aggregation conversions', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let occurredOnId: string;
    let statusId: string;
    let hostRecordId: string;
    let activeFilter: any;

    const ACTIVE_LATEST_DATE = '2024-01-15T08:00:00.000Z';

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'RefLookup_Date_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'OccurredOn', type: FieldType.Date } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Title: 'Alpha',
              Status: 'Active',
              OccurredOn: '2024-01-10T08:00:00.000Z',
            },
          },
          {
            fields: {
              Title: 'Beta',
              Status: 'Active',
              OccurredOn: ACTIVE_LATEST_DATE,
            },
          },
          {
            fields: {
              Title: 'Gamma',
              Status: 'Closed',
              OccurredOn: '2024-01-01T08:00:00.000Z',
            },
          },
        ],
      });
      occurredOnId = foreign.fields.find((f) => f.name === 'OccurredOn')!.id;
      statusId = foreign.fields.find((f) => f.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'RefLookup_Date_Host',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Label: 'Row 1' } }],
      });
      hostRecordId = host.records[0].id;

      activeFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: 'Active',
          },
        ],
      } as any;

      lookupField = await createField(host.id, {
        name: 'Active Event Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: occurredOnId,
          expression: 'count({values})',
          filter: activeFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('converts to datetime aggregation without casting errors', async () => {
      const baseline = await getRecord(host.id, hostRecordId);
      expect(baseline.fields[lookupField.id]).toEqual(2);

      lookupField = await convertField(host.id, lookupField.id, {
        name: 'Latest Active Event',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: occurredOnId,
          expression: 'max({values})',
          filter: activeFilter,
        },
      } as IFieldRo);

      expect(lookupField.cellValueType).toBe(CellValueType.DateTime);
      expect(lookupField.dbFieldType).toBe(DbFieldType.DateTime);

      const afterConversion = await getRecord(host.id, hostRecordId);
      expect(afterConversion.fields[lookupField.id]).toEqual(ACTIVE_LATEST_DATE);
    });
  });

  describe('interoperability with standard lookup fields', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let consumer: ITableFullVo;
    let foreignAmountFieldId: string;
    let conditionalRollupField: IFieldVo;
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

      conditionalRollupField = await createField(host.id, {
        name: 'Category Amount Total',
        type: FieldType.ConditionalRollup,
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

    it('rejects creating a standard lookup targeting a conditional rollup field', async () => {
      const hostRecord = await getRecord(host.id, host.records[0].id);
      expect(hostRecord.fields[conditionalRollupField.id]).toEqual(130);

      await expect(
        createField(consumer.id, {
          name: 'Lookup Category Total',
          type: FieldType.ConditionalRollup,
          isLookup: true,
          lookupOptions: {
            foreignTableId: host.id,
            linkFieldId: consumerLinkField.id,
            lookupFieldId: conditionalRollupField.id,
          } as ILookupOptionsRo,
        } as IFieldRo)
      ).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('conditional rollup targeting derived fields', () => {
    let suppliers: ITableFullVo;
    let products: ITableFullVo;
    let host: ITableFullVo;
    let supplierRatingId: string;
    let linkToSupplierField: IFieldVo;
    let supplierRatingLookup: IFieldVo;
    let supplierRatingRollup: IFieldVo;
    let conditionalRollupMax: IFieldVo;
    let referenceRollupSum: IFieldVo;
    let referenceLinkCount: IFieldVo;

    beforeAll(async () => {
      suppliers = await createTable(baseId, {
        name: 'RefLookup_Supplier',
        fields: [
          { name: 'SupplierName', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          {
            name: 'Rating',
            type: FieldType.Number,
            options: {
              formatting: {
                type: NumberFormattingType.Decimal,
                precision: 2,
              },
            },
          } as IFieldRo,
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
          { name: 'ProductName', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Category', type: FieldType.SingleLineText, options: {} } as IFieldRo,
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
        fields: [{ name: 'Summary', type: FieldType.SingleLineText, options: {} } as IFieldRo],
        records: [{ fields: { Summary: 'Global' } }],
      });

      conditionalRollupMax = await createField(host.id, {
        name: 'Supplier Rating Max (Lookup)',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingLookup.id,
          expression: 'max({values})',
        },
      } as IFieldRo);

      referenceRollupSum = await createField(host.id, {
        name: 'Supplier Rating Total (Rollup)',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingRollup.id,
          expression: 'sum({values})',
        },
      } as IFieldRo);

      referenceLinkCount = await createField(host.id, {
        name: 'Linked Supplier Count',
        type: FieldType.ConditionalRollup,
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

    it('aggregates lookup-derived conditional rollup values', async () => {
      const hostRecord = await getRecord(host.id, host.records[0].id);
      expect(hostRecord.fields[conditionalRollupMax.id]).toEqual(5);
      expect(hostRecord.fields[referenceRollupSum.id]).toEqual(13);
      expect(hostRecord.fields[referenceLinkCount.id]).toEqual(3);
    });

    it('tracks dependencies when conditional rollup targets derived fields', async () => {
      const initialHostFields = await getFields(host.id);
      const initialLookupMax = initialHostFields.find(
        (f) => f.id === conditionalRollupMax.id
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
      expect(afterLookupDelete.find((f) => f.id === conditionalRollupMax.id)?.hasError).toBe(true);

      await deleteField(products.id, supplierRatingRollup.id);
      const afterRollupDelete = await getFields(host.id);
      expect(afterRollupDelete.find((f) => f.id === referenceRollupSum.id)?.hasError).toBe(true);

      await deleteField(products.id, linkToSupplierField.id);
      const afterLinkDelete = await getFields(host.id);
      expect(afterLinkDelete.find((f) => f.id === referenceLinkCount.id)?.hasError).toBe(true);
    });
  });

  describe('conditional rollup across bases', () => {
    let foreignBaseId: string;
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let crossBaseRollup: IFieldVo;
    let foreignCategoryId: string;
    let foreignAmountId: string;
    let hostCategoryId: string;
    let hardwareRecordId: string;
    let softwareRecordId: string;

    beforeAll(async () => {
      const spaceId = globalThis.testConfig.spaceId;
      const createdBase = await createBase({ spaceId, name: 'Conditional Rollup Cross Base' });
      foreignBaseId = createdBase.id;

      foreign = await createTable(foreignBaseId, {
        name: 'CrossBase_Foreign',
        fields: [
          { name: 'Category', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          {
            name: 'Amount',
            type: FieldType.Number,
            options: {
              formatting: {
                type: NumberFormattingType.Decimal,
                precision: 2,
              },
            },
          } as IFieldRo,
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
        name: 'CrossBase_Host',
        fields: [
          { name: 'CategoryMatch', type: FieldType.SingleLineText, options: {} } as IFieldRo,
        ],
        records: [
          { fields: { CategoryMatch: 'Hardware' } },
          { fields: { CategoryMatch: 'Software' } },
        ],
      });
      hostCategoryId = host.fields.find((f) => f.name === 'CategoryMatch')!.id;
      hardwareRecordId = host.records[0].id;
      softwareRecordId = host.records[1].id;

      const categoryFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: foreignCategoryId,
            operator: 'is',
            value: { type: 'field', fieldId: hostCategoryId },
          },
        ],
      } as any;

      crossBaseRollup = await createField(host.id, {
        name: 'Cross Base Amount Total',
        type: FieldType.ConditionalRollup,
        options: {
          baseId: foreignBaseId,
          foreignTableId: foreign.id,
          lookupFieldId: foreignAmountId,
          expression: 'sum({values})',
          filter: categoryFilter,
        },
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

      expect(hardwareRecord.fields[crossBaseRollup.id]).toEqual(150);
      expect(softwareRecord.fields[crossBaseRollup.id]).toEqual(70);
    });
  });

  describe('conditional rollup aggregating formula fields', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let conditionalRollupField: IFieldVo;
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
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
      };
      const taxField: IFieldRo = {
        id: taxFieldId,
        name: 'Tax',
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
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
          { name: 'Category', type: FieldType.SingleLineText, options: {} } as IFieldRo,
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
        fields: [
          { name: 'CategoryFilter', type: FieldType.SingleLineText, options: {} } as IFieldRo,
        ],
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

      conditionalRollupField = await createField(host.id, {
        name: 'Total Formula Sum',
        type: FieldType.ConditionalRollup,
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

      expect(hardwareRecord.fields[conditionalRollupField.id]).toEqual('110');
      expect(softwareRecord.fields[conditionalRollupField.id]).toEqual('55');

      await updateRecordByApi(foreign.id, foreign.records[0].id, baseFieldId, 120);

      const updatedHardware = await getRecord(host.id, hardwareHostRecordId);
      expect(updatedHardware.fields[conditionalRollupField.id]).toEqual('130');

      const updatedSoftware = await getRecord(host.id, softwareHostRecordId);
      expect(updatedSoftware.fields[conditionalRollupField.id]).toEqual('55');
    });
  });
});
