/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type {
  IConditionalRollupFieldOptions,
  IFieldRo,
  IFieldVo,
  IFilter,
  ILookupOptionsRo,
} from '@teable/core';
import { Colors, FieldKeyType, FieldType, NumberFormattingType, Relationship } from '@teable/core';
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

  describe('boolean field reference filters', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let booleanLookupField: IFieldVo;
    let titleFieldId: string;
    let statusFieldId: string;
    let hostFlagFieldId: string;
    let hostTrueRecordId: string;
    let hostUnsetRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Bool_Foreign',
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
      titleFieldId = foreign.fields.find((field) => field.name === 'Title')!.id;
      statusFieldId = foreign.fields.find((field) => field.name === 'IsActive')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Bool_Host',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'TargetActive', type: FieldType.Checkbox } as IFieldRo,
        ],
        records: [
          { fields: { Name: 'Should Match True', TargetActive: true } },
          { fields: { Name: 'Should Match Unset' } },
        ],
      });
      hostFlagFieldId = host.fields.find((field) => field.name === 'TargetActive')!.id;
      hostTrueRecordId = host.records[0].id;
      hostUnsetRecordId = host.records[1].id;

      const booleanFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: hostFlagFieldId },
          },
        ],
      };

      booleanLookupField = await createField(host.id, {
        name: 'Matching Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleFieldId,
          filter: booleanFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should filter boolean-referenced lookups', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hostTrueRecord = records.records.find((record) => record.id === hostTrueRecordId)!;
      const hostUnsetRecord = records.records.find((record) => record.id === hostUnsetRecordId)!;

      expect(hostTrueRecord.fields[booleanLookupField.id]).toEqual(['Alpha', 'Gamma']);
      expect(hostUnsetRecord.fields[booleanLookupField.id] ?? []).toEqual([]);
    });

    it('should react when host boolean criteria change', async () => {
      await updateRecordByApi(host.id, hostTrueRecordId, hostFlagFieldId, null);
      await updateRecordByApi(host.id, hostUnsetRecordId, hostFlagFieldId, true);

      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hostTrueRecord = records.records.find((record) => record.id === hostTrueRecordId)!;
      const hostUnsetRecord = records.records.find((record) => record.id === hostUnsetRecordId)!;

      expect(hostTrueRecord.fields[booleanLookupField.id] ?? []).toEqual([]);
      expect(hostUnsetRecord.fields[booleanLookupField.id]).toEqual(['Alpha', 'Gamma']);
    });
  });

  describe('field and literal comparison matrix', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let fieldDrivenTitlesField: IFieldVo;
    let literalMixTitlesField: IFieldVo;
    let quantityWindowLookupField: IFieldVo;
    let titleId: string;
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
        name: 'ConditionalLookup_FieldMatrix_Foreign',
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
      titleId = foreign.fields.find((f) => f.name === 'Title')!.id;
      categoryId = foreign.fields.find((f) => f.name === 'Category')!.id;
      amountId = foreign.fields.find((f) => f.name === 'Amount')!.id;
      quantityId = foreign.fields.find((f) => f.name === 'Quantity')!.id;
      statusId = foreign.fields.find((f) => f.name === 'Status')!.id;
      foreignLaptopId = foreign.records.find((record) => record.fields.Title === 'Laptop')!.id;
      foreignMonitorId = foreign.records.find((record) => record.fields.Title === 'Monitor')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_FieldMatrix_Host',
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

      const fieldDrivenFilter: IFilter = {
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
      };

      fieldDrivenTitlesField = await createField(host.id, {
        name: 'Field Driven Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter: fieldDrivenFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const literalMixFilter: IFilter = {
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
      };

      literalMixTitlesField = await createField(host.id, {
        name: 'Literal Mix Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter: literalMixFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const quantityWindowFilter: IFilter = {
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
      };

      quantityWindowLookupField = await createField(host.id, {
        name: 'Quantity Window Values',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: quantityId,
          filter: quantityWindowFilter,
        } as ILookupOptionsRo,
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

      expect(hardwareActive.fields[fieldDrivenTitlesField.id]).toEqual(['Laptop']);
      expect(officeActive.fields[fieldDrivenTitlesField.id]).toEqual(['Subscription', 'Upgrade']);
      expect(hardwareInactive.fields[fieldDrivenTitlesField.id]).toEqual(['Monitor']);
    });

    it('should mix literal and field referenced criteria', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareActive = records.records.find((record) => record.id === hostHardwareActiveId)!;
      const officeActive = records.records.find((record) => record.id === hostOfficeActiveId)!;
      const hardwareInactive = records.records.find(
        (record) => record.id === hostHardwareInactiveId
      )!;

      expect(hardwareActive.fields[literalMixTitlesField.id]).toEqual(['Monitor']);
      expect(officeActive.fields[literalMixTitlesField.id]).toEqual(['Monitor']);
      expect(hardwareInactive.fields[literalMixTitlesField.id]).toEqual(['Laptop']);
    });

    it('should support field referenced numeric windows with lookups', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const hardwareActive = records.records.find((record) => record.id === hostHardwareActiveId)!;
      const officeActive = records.records.find((record) => record.id === hostOfficeActiveId)!;
      const hardwareInactive = records.records.find(
        (record) => record.id === hostHardwareInactiveId
      )!;

      expect(hardwareActive.fields[quantityWindowLookupField.id]).toEqual([5, 2]);
      expect(officeActive.fields[quantityWindowLookupField.id]).toEqual([10, 3]);
      expect(hardwareInactive.fields[quantityWindowLookupField.id]).toEqual([2]);
    });

    it('should recompute when host thresholds change', async () => {
      await updateRecordByApi(host.id, hostHardwareActiveId, amountFloorId, 90);
      const tightened = await getRecord(host.id, hostHardwareActiveId);
      expect(tightened.fields[fieldDrivenTitlesField.id] ?? []).toEqual([]);

      await updateRecordByApi(host.id, hostHardwareActiveId, amountFloorId, 60);
      const restored = await getRecord(host.id, hostHardwareActiveId);
      expect(restored.fields[fieldDrivenTitlesField.id]).toEqual(['Laptop']);
    });
  });

  describe('advanced operator coverage', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let tierWindowNamesField: IFieldVo;
    let tagAllLookupField: IFieldVo;
    let tagNoneLookupField: IFieldVo;
    let ratingValuesLookupField: IFieldVo;
    let currencyScoreLookupField: IFieldVo;
    let percentScoreLookupField: IFieldVo;
    let tierSelectLookupField: IFieldVo;
    let nameId: string;
    let tierId: string;
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
        name: 'ConditionalLookup_AdvancedOps_Foreign',
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
        name: 'ConditionalLookup_AdvancedOps_Host',
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

      const tierWindowFilter: IFilter = {
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
      };

      tierWindowNamesField = await createField(host.id, {
        name: 'Tier Window Names',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: nameId,
          filter: tierWindowFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      tagAllLookupField = await createField(host.id, {
        name: 'Tag All Names',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: nameId,
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
        } as ILookupOptionsRo,
      } as IFieldRo);

      tagNoneLookupField = await createField(host.id, {
        name: 'Tag None Names',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: nameId,
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
        } as ILookupOptionsRo,
      } as IFieldRo);

      ratingValuesLookupField = await createField(host.id, {
        name: 'Rating Values',
        type: FieldType.Rating,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: ratingId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: ratingId,
                operator: 'isNotEmpty',
                value: null,
              },
            ],
          },
        } as ILookupOptionsRo,
      } as IFieldRo);

      currencyScoreLookupField = await createField(host.id, {
        name: 'Score Currency Lookup',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        options: {
          formatting: {
            type: NumberFormattingType.Currency,
            symbol: '¥',
            precision: 1,
          },
        },
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: scoreId,
                operator: 'isNotEmpty',
                value: null,
              },
            ],
          },
        } as ILookupOptionsRo,
      } as IFieldRo);

      percentScoreLookupField = await createField(host.id, {
        name: 'Score Percent Lookup',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        options: {
          formatting: {
            type: NumberFormattingType.Percent,
            precision: 2,
          },
        },
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: scoreId,
                operator: 'isNotEmpty',
                value: null,
              },
            ],
          },
        } as ILookupOptionsRo,
      } as IFieldRo);

      tierSelectLookupField = await createField(host.id, {
        name: 'Tier Select Lookup',
        type: FieldType.SingleSelect,
        isLookup: true,
        isConditionalLookup: true,
        options: {
          choices: tierChoices,
        },
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: tierId,
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
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should evaluate combined field-referenced conditions across heterogeneous types', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const row1 = records.records.find((record) => record.id === hostRow1Id)!;
      const row2 = records.records.find((record) => record.id === hostRow2Id)!;
      const row3 = records.records.find((record) => record.id === hostRow3Id)!;

      expect(row1.fields[tierWindowNamesField.id]).toEqual(['Alpha']);
      expect(row2.fields[tierWindowNamesField.id]).toEqual(['Beta']);
      expect(row3.fields[tierWindowNamesField.id] ?? []).toEqual([]);
    });

    it('should evaluate multi-select operators within lookups', async () => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const row1 = records.records.find((record) => record.id === hostRow1Id)!;
      const row2 = records.records.find((record) => record.id === hostRow2Id)!;
      const row3 = records.records.find((record) => record.id === hostRow3Id)!;

      const expectedTagAll = ['Alpha', 'Beta', 'Delta', 'Epsilon'].sort();
      const expectedTagNone = ['Alpha', 'Beta', 'Gamma', 'Epsilon'].sort();

      const row1TagAll = [...(row1.fields[tagAllLookupField.id] as string[])].sort();
      const row2TagAll = [...(row2.fields[tagAllLookupField.id] as string[])].sort();
      const row3TagAll = [...(row3.fields[tagAllLookupField.id] as string[])].sort();
      expect(row1TagAll).toEqual(expectedTagAll);
      expect(row2TagAll).toEqual(expectedTagAll);
      expect(row3TagAll).toEqual(expectedTagAll);

      const row1TagNone = [...(row1.fields[tagNoneLookupField.id] as string[])].sort();
      const row2TagNone = [...(row2.fields[tagNoneLookupField.id] as string[])].sort();
      const row3TagNone = [...(row3.fields[tagNoneLookupField.id] as string[])].sort();
      expect(row1TagNone).toEqual(expectedTagNone);
      expect(row2TagNone).toEqual(expectedTagNone);
      expect(row3TagNone).toEqual(expectedTagNone);
    });

    it('should filter rating values while excluding empty entries', async () => {
      const record = await getRecord(host.id, hostRow1Id);
      const ratings = [...(record.fields[ratingValuesLookupField.id] as number[])].sort();
      expect(ratings).toEqual([2, 4, 4, 5]);
    });

    it('should persist numeric formatting options on lookup fields', async () => {
      const currencyFieldMeta = await getField(host.id, currencyScoreLookupField.id);
      const currencyFormatting = currencyFieldMeta.options as {
        formatting?: { type: NumberFormattingType; precision?: number; symbol?: string };
      };
      expect(currencyFormatting.formatting).toEqual({
        type: NumberFormattingType.Currency,
        symbol: '¥',
        precision: 1,
      });

      const percentFieldMeta = await getField(host.id, percentScoreLookupField.id);
      const percentFormatting = percentFieldMeta.options as {
        formatting?: { type: NumberFormattingType; precision?: number };
      };
      expect(percentFormatting.formatting).toEqual({
        type: NumberFormattingType.Percent,
        precision: 2,
      });

      const record = await getRecord(host.id, hostRow1Id);
      const expectedTotals = [25, 30, 45, 55, 80];
      const currencyValues = [...(record.fields[currencyScoreLookupField.id] as number[])].sort(
        (a, b) => a - b
      );
      const percentValues = [...(record.fields[percentScoreLookupField.id] as number[])].sort(
        (a, b) => a - b
      );
      expect(currencyValues).toEqual(expectedTotals);
      expect(percentValues).toEqual(expectedTotals);
    });

    it('should include select metadata within lookup results', async () => {
      const record = await getRecord(host.id, hostRow1Id);
      const tiers = record.fields[tierSelectLookupField.id] as Array<
        string | { id: string; name: string; color: string }
      >;
      expect(Array.isArray(tiers)).toBe(true);
      const tierNames = tiers
        .map((tier) => (typeof tier === 'string' ? tier : tier.name))
        .filter((name): name is string => Boolean(name))
        .sort();
      expect(tierNames).toEqual(['Basic', 'Enterprise', 'Pro', 'Pro'].sort());
      tiers.forEach((tier) => {
        if (typeof tier === 'string') {
          expect(typeof tier).toBe('string');
          return;
        }
        expect(typeof tier.id).toBe('string');
        expect(typeof tier.color).toBe('string');
      });
    });

    it('should recompute when host filters change', async () => {
      await updateRecordByApi(host.id, hostRow1Id, maxScoreId, 40);
      const tightened = await getRecord(host.id, hostRow1Id);
      expect(tightened.fields[tierWindowNamesField.id] ?? []).toEqual([]);

      await updateRecordByApi(host.id, hostRow1Id, maxScoreId, 60);
      const restored = await getRecord(host.id, hostRow1Id);
      expect(restored.fields[tierWindowNamesField.id]).toEqual(['Alpha']);

      await updateRecordByApi(host.id, hostRow2Id, minRatingId, 6);
      const stricter = await getRecord(host.id, hostRow2Id);
      expect(stricter.fields[tierWindowNamesField.id] ?? []).toEqual([]);

      await updateRecordByApi(host.id, hostRow2Id, minRatingId, 4);
      const ratingRestored = await getRecord(host.id, hostRow2Id);
      expect(ratingRestored.fields[tierWindowNamesField.id]).toEqual(['Beta']);
    });
  });

  describe('conditional lookup referencing derived field types', () => {
    let suppliers: ITableFullVo;
    let products: ITableFullVo;
    let host: ITableFullVo;
    let supplierRatingId: string;
    let linkToSupplierField: IFieldVo;
    let supplierRatingLookup: IFieldVo;
    let supplierRatingRollup: IFieldVo;
    let supplierRatingConditionalLookup: IFieldVo;
    let supplierRatingConditionalRollup: IFieldVo;
    let supplierRatingDoubleFormula: IFieldVo;
    let ratingValuesLookupField: IFieldVo;
    let ratingFormulaLookupField: IFieldVo;
    let supplierLinkLookupField: IFieldVo;
    let conditionalLookupMirrorField: IFieldVo;
    let conditionalRollupMirrorField: IFieldVo;
    let hostProductsLinkField: IFieldVo;
    let minSupplierRatingFieldId: string;
    let supplierNameFieldId: string;
    let productSupplierNameFieldId: string;

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
      supplierNameFieldId = suppliers.fields.find((f) => f.name === 'SupplierName')!.id;

      products = await createTable(baseId, {
        name: 'ConditionalLookup_Product',
        fields: [
          { name: 'ProductName', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Supplier Name', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { ProductName: 'Laptop', 'Supplier Name': 'Supplier A' } },
          { fields: { ProductName: 'Mouse', 'Supplier Name': 'Supplier B' } },
          { fields: { ProductName: 'Subscription', 'Supplier Name': 'Supplier B' } },
        ],
      });
      productSupplierNameFieldId = products.fields.find((f) => f.name === 'Supplier Name')!.id;

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

      const minSupplierRatingField = await createField(products.id, {
        name: 'Minimum Supplier Rating',
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 1,
          },
        },
      } as IFieldRo);
      minSupplierRatingFieldId = minSupplierRatingField.id;

      await updateRecordByApi(products.id, products.records[0].id, minSupplierRatingFieldId, 4.5);
      await updateRecordByApi(products.id, products.records[1].id, minSupplierRatingFieldId, 3.5);
      await updateRecordByApi(products.id, products.records[2].id, minSupplierRatingFieldId, 4.5);

      supplierRatingConditionalLookup = await createField(products.id, {
        name: 'Supplier Rating Conditional Lookup',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 1,
          },
        },
        lookupOptions: {
          foreignTableId: suppliers.id,
          lookupFieldId: supplierRatingId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: supplierNameFieldId,
                operator: 'is',
                value: { type: 'field', fieldId: productSupplierNameFieldId },
              },
              {
                fieldId: supplierRatingId,
                operator: 'isGreaterEqual',
                value: { type: 'field', fieldId: minSupplierRatingFieldId },
              },
            ],
          },
        } as ILookupOptionsRo,
      } as IFieldRo);

      supplierRatingDoubleFormula = await createField(products.id, {
        name: 'Supplier Rating Double',
        type: FieldType.Formula,
        options: {
          expression: `{${supplierRatingLookup.id}} * 2`,
        },
      } as IFieldRo);

      const supplierRatingConditionalRollupOptions: IConditionalRollupFieldOptions = {
        foreignTableId: suppliers.id,
        lookupFieldId: supplierRatingId,
        expression: 'sum({values})',
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: supplierNameFieldId,
              operator: 'is',
              value: { type: 'field', fieldId: productSupplierNameFieldId },
            },
            {
              fieldId: supplierRatingId,
              operator: 'isGreaterEqual',
              value: { type: 'field', fieldId: minSupplierRatingFieldId },
            },
          ],
        },
      };

      supplierRatingConditionalRollup = await createField(products.id, {
        name: 'Supplier Rating Conditional Sum',
        type: FieldType.ConditionalRollup,
        options: supplierRatingConditionalRollupOptions,
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

      ratingFormulaLookupField = await createField(host.id, {
        name: 'Supplier Ratings Doubled (Lookup)',
        type: FieldType.Formula,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingDoubleFormula.id,
          filter: ratingPresentFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      supplierLinkLookupField = await createField(host.id, {
        name: 'Supplier Links (Lookup)',
        type: FieldType.Link,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: products.id,
          lookupFieldId: linkToSupplierField.id,
          filter: ratingPresentFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const conditionalLookupHasValueFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: supplierRatingConditionalLookup.id,
            operator: 'isNotEmpty',
            value: null,
          },
        ],
      };

      conditionalLookupMirrorField = await createField(host.id, {
        name: 'Supplier Ratings (Conditional Lookup Source)',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingConditionalLookup.id,
          filter: conditionalLookupHasValueFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const positiveConditionalRollupFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: supplierRatingConditionalRollup.id,
            operator: 'isGreater',
            value: 0,
          },
        ],
      };

      conditionalRollupMirrorField = await createField(host.id, {
        name: 'Supplier Rating Conditional Sums (Lookup)',
        type: FieldType.ConditionalRollup,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: products.id,
          lookupFieldId: supplierRatingConditionalRollup.id,
          filter: positiveConditionalRollupFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, products.id);
      await permanentDeleteTable(baseId, suppliers.id);
    });

    describe('standard lookup source', () => {
      it('returns lookup values from lookup fields', async () => {
        const hostRecord = await getRecord(host.id, host.records[0].id);
        expect(hostRecord.fields[ratingValuesLookupField.id]).toEqual([5, 4, 4]);
      });
    });

    describe('formula source', () => {
      it('projects formula results from foreign fields', async () => {
        const hostRecord = await getRecord(host.id, host.records[0].id);
        expect(hostRecord.fields[ratingFormulaLookupField.id]).toEqual([10, 8, 8]);
      });
    });

    describe('link source', () => {
      it('includes link metadata for targeted link fields', async () => {
        const hostRecord = await getRecord(host.id, host.records[0].id);
        const linkValues = hostRecord.fields[supplierLinkLookupField.id] as Array<{
          id: string;
          title: string;
        }>;
        expect(Array.isArray(linkValues)).toBe(true);
        expect(linkValues).toHaveLength(3);
        const supplierIds = linkValues.map((link) => link.id).sort();
        expect(supplierIds).toEqual(
          [suppliers.records[0].id, suppliers.records[1].id, suppliers.records[1].id].sort()
        );
        linkValues.forEach((link) => {
          expect(typeof link.title).toBe('string');
          expect(link.title.length).toBeGreaterThan(0);
        });
      });
    });

    describe('conditional lookup source', () => {
      it('retrieves filtered values and mirrors formatting', async () => {
        const hostRecord = await getRecord(host.id, host.records[0].id);
        expect(hostRecord.fields[conditionalLookupMirrorField.id]).toEqual([5, 4]);

        const hostFieldDetail = await getField(host.id, conditionalLookupMirrorField.id);
        const foreignFieldDetail = await getField(products.id, supplierRatingConditionalLookup.id);
        expect(hostFieldDetail.options).toEqual(foreignFieldDetail.options);
      });
    });

    describe('conditional rollup source', () => {
      it('collects aggregates from conditional rollup fields', async () => {
        const hostRecord = await getRecord(host.id, host.records[0].id);
        expect(hostRecord.fields[conditionalRollupMirrorField.id]).toEqual([5, 4]);
      });
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
