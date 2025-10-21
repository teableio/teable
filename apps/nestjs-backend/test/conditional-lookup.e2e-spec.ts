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
  IConditionalLookupOptions,
} from '@teable/core';
import {
  isConditionalLookupOptions,
  Colors,
  DbFieldType,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  Relationship,
  SortFunc,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  convertField,
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
    let activeHostRecordId: string;
    let gammaRecordId: string;
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
      gammaRecordId = foreign.records.find((record) => record.fields.Title === 'Gamma')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText, options: {} } as IFieldRo],
        records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Closed' } }],
      });
      statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;
      activeHostRecordId = host.records.find(
        (record) => record.fields.StatusFilter === 'Active'
      )!.id;

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

    it('should refresh conditional lookup when foreign records enter the filter', async () => {
      const baseline = await getRecord(host.id, activeHostRecordId);
      expect(baseline.fields[lookupField.id]).toEqual(['Alpha', 'Beta']);

      await updateRecordByApi(foreign.id, gammaRecordId, statusId, 'Active');
      const afterStatus = await getRecord(host.id, activeHostRecordId);
      expect(afterStatus.fields[lookupField.id]).toEqual(['Alpha', 'Beta', 'Gamma']);

      await updateRecordByApi(foreign.id, gammaRecordId, titleId, 'Gamma Updated');
      const afterTitle = await getRecord(host.id, activeHostRecordId);
      expect(afterTitle.fields[lookupField.id]).toEqual(['Alpha', 'Beta', 'Gamma Updated']);

      await updateRecordByApi(foreign.id, gammaRecordId, titleId, 'Gamma');
      await updateRecordByApi(foreign.id, gammaRecordId, statusId, 'Closed');
      const restored = await getRecord(host.id, activeHostRecordId);
      expect(restored.fields[lookupField.id]).toEqual(['Alpha', 'Beta']);
    });
  });

  describe('filter option synchronization', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let titleId: string;
    let statusId: string;
    const statusChoices = [
      { id: 'status-active', name: 'Active', color: Colors.Green },
      { id: 'status-closed', name: 'Closed', color: Colors.Gray },
    ];

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Filter_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: { choices: statusChoices },
          } as IFieldRo,
        ],
      });
      titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
      statusId = foreign.fields.find((field) => field.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Filter_Host',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
      });

      const filter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusId,
            operator: 'is',
            value: 'Active',
          },
        ],
      };

      lookupField = await createField(host.id, {
        name: 'Active Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should update conditional lookup filters when select option names change', async () => {
      await convertField(foreign.id, statusId, {
        name: 'Status',
        type: FieldType.SingleSelect,
        options: {
          choices: [{ ...statusChoices[0], name: 'Active Plus' }, statusChoices[1]],
        },
      } as IFieldRo);

      const refreshed = await getField(host.id, lookupField.id);
      const updatedLookup = refreshed.lookupOptions as IConditionalLookupOptions | undefined;
      const filterItem = updatedLookup?.filter?.filterSet?.[0];
      // @ts-expect-error handle value
      expect(filterItem?.value).toBe('Active Plus');
    });
  });

  describe('sort and limit options', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let titleId: string;
    let statusId: string;
    let scoreId: string;
    let statusFilterId: string;
    let activeRecordId: string;
    let closedRecordId: string;
    let gammaRecordId: string;
    let statusMatchFilter: IFilter;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Sort_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Score', type: FieldType.Number, options: {} } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', Status: 'Active', Score: 70 } },
          { fields: { Title: 'Beta', Status: 'Active', Score: 90 } },
          { fields: { Title: 'Gamma', Status: 'Active', Score: 40 } },
          { fields: { Title: 'Delta', Status: 'Closed', Score: 100 } },
        ],
      });
      titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
      statusId = foreign.fields.find((field) => field.name === 'Status')!.id;
      scoreId = foreign.fields.find((field) => field.name === 'Score')!.id;
      gammaRecordId = foreign.records.find((record) => record.fields.Title === 'Gamma')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Sort_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText, options: {} } as IFieldRo],
        records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Closed' } }],
      });
      statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;
      activeRecordId = host.records[0].id;
      closedRecordId = host.records[1].id;

      statusMatchFilter = {
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
        name: 'Top Scores',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter: statusMatchFilter,
          sort: {
            fieldId: scoreId,
            order: SortFunc.Desc,
          },
          limit: 2,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should apply sort and limit to conditional lookup results', async () => {
      const originalField = await getField(host.id, lookupField.id);
      const originalLookupOptions = originalField.lookupOptions as ILookupOptionsRo;
      const originalOptions = originalField.options;
      const originalName = originalField.name;

      try {
        expect(originalLookupOptions).toMatchObject({
          sort: { fieldId: scoreId, order: SortFunc.Desc },
          limit: 2,
        });

        const initialRecords = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
        const initialActive = initialRecords.records.find(
          (record) => record.id === activeRecordId
        )!;
        const initialClosed = initialRecords.records.find(
          (record) => record.id === closedRecordId
        )!;
        expect(initialActive.fields[lookupField.id]).toEqual(['Beta', 'Alpha']);
        expect(initialClosed.fields[lookupField.id]).toEqual(['Delta']);

        lookupField = await convertField(host.id, lookupField.id, {
          name: lookupField.name,
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          options: lookupField.options,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            filter: statusMatchFilter,
            sort: {
              fieldId: scoreId,
              order: SortFunc.Asc,
            },
            limit: 1,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const ascField = await getField(host.id, lookupField.id);
        expect(ascField.lookupOptions).toMatchObject({
          sort: { fieldId: scoreId, order: SortFunc.Asc },
          limit: 1,
        });

        let activeRecord = await getRecord(host.id, activeRecordId);
        const closedRecord = await getRecord(host.id, closedRecordId);
        expect(activeRecord.fields[lookupField.id]).toEqual(['Gamma']);
        expect(closedRecord.fields[lookupField.id]).toEqual(['Delta']);

        await updateRecordByApi(foreign.id, gammaRecordId, scoreId, 75);
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[lookupField.id]).toEqual(['Alpha']);

        await updateRecordByApi(foreign.id, gammaRecordId, scoreId, 40);
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[lookupField.id]).toEqual(['Gamma']);

        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Closed');
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[lookupField.id]).toEqual(['Delta']);

        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Active');
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[lookupField.id]).toEqual(['Gamma']);

        lookupField = await convertField(host.id, lookupField.id, {
          name: lookupField.name,
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          options: lookupField.options,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            filter: statusMatchFilter,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const disabledField = await getField(host.id, lookupField.id);
        const disabledOptions = disabledField.lookupOptions;
        if (!isConditionalLookupOptions(disabledOptions)) {
          throw new Error('expected conditional lookup options');
        }
        expect(disabledOptions.sort).toBeUndefined();
        expect(disabledOptions.limit).toBeUndefined();

        const unsortedRecords = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
        const unsortedActive = unsortedRecords.records.find(
          (record) => record.id === activeRecordId
        )!;
        const unsortedClosed = unsortedRecords.records.find(
          (record) => record.id === closedRecordId
        )!;
        const activeTitles = [...(unsortedActive.fields[lookupField.id] as string[])].sort();
        expect(activeTitles).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(unsortedClosed.fields[lookupField.id]).toEqual(['Delta']);
      } finally {
        lookupField = await convertField(host.id, lookupField.id, {
          name: originalName,
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          options: originalOptions,
          lookupOptions: originalLookupOptions,
        } as IFieldRo);
        await updateRecordByApi(foreign.id, gammaRecordId, scoreId, 40);
        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Active');
      }
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

  describe('text filter edge cases', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let emptyLabelScoresField: IFieldVo;
    let nonEmptyLabelsField: IFieldVo;
    let alphaNotesField: IFieldVo;
    let labelId: string;
    let notesId: string;
    let scoreId: string;
    let hostRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Text_Foreign',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Notes', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Label: 'Alpha', Notes: 'Alpha plan', Score: 10 } },
          { fields: { Label: '', Notes: 'Empty label entry', Score: 5 } },
          { fields: { Notes: 'Missing label Alpha entry', Score: 7 } },
          { fields: { Label: 'Beta', Notes: 'Beta details', Score: 12 } },
          { fields: { Label: 'Gamma', Notes: 'General info', Score: 8 } },
        ],
      });

      labelId = foreign.fields.find((field) => field.name === 'Label')!.id;
      notesId = foreign.fields.find((field) => field.name === 'Notes')!.id;
      scoreId = foreign.fields.find((field) => field.name === 'Score')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Text_Host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Name: 'Row 1' } }],
      });
      hostRecordId = host.records[0].id;

      emptyLabelScoresField = await createField(host.id, {
        name: 'Empty Label Scores',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: labelId,
                operator: 'isEmpty',
                value: null,
              },
            ],
          },
        } as ILookupOptionsRo,
      } as IFieldRo);

      nonEmptyLabelsField = await createField(host.id, {
        name: 'Non Empty Labels',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: labelId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: labelId,
                operator: 'isNotEmpty',
                value: null,
              },
            ],
          },
        } as ILookupOptionsRo,
      } as IFieldRo);

      alphaNotesField = await createField(host.id, {
        name: 'Alpha Notes',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: notesId,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: notesId,
                operator: 'contains',
                value: 'Alpha',
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

    it('should include values when filtering for empty text', async () => {
      const record = await getRecord(host.id, hostRecordId);

      expect(record.fields[emptyLabelScoresField.id]).toEqual([5, 7]);
    });

    it('should exclude blanks when using isNotEmpty filters', async () => {
      const record = await getRecord(host.id, hostRecordId);

      expect(record.fields[nonEmptyLabelsField.id]).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('should support contains filters against text fields', async () => {
      const record = await getRecord(host.id, hostRecordId);

      expect(record.fields[alphaNotesField.id]).toEqual([
        'Alpha plan',
        'Missing label Alpha entry',
      ]);
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

    it('should preserve computed metadata when renaming select lookups via convertField', async () => {
      const beforeRename = await getField(host.id, tierSelectLookupField.id);
      expect(beforeRename.dbFieldType).toBe(DbFieldType.Json);
      expect(beforeRename.isMultipleCellValue).toBe(true);
      expect(beforeRename.isComputed).toBe(true);
      expect(beforeRename.lookupOptions).toBeDefined();

      const originalName = beforeRename.name;
      const fieldId = tierSelectLookupField.id;

      try {
        tierSelectLookupField = await convertField(host.id, fieldId, {
          name: 'Tier Select Lookup Renamed',
          type: FieldType.SingleSelect,
          isLookup: true,
          isConditionalLookup: true,
          options: beforeRename.options,
          lookupOptions: beforeRename.lookupOptions as ILookupOptionsRo,
        } as IFieldRo);

        expect(tierSelectLookupField.name).toBe('Tier Select Lookup Renamed');
        expect(tierSelectLookupField.dbFieldType).toBe(DbFieldType.Json);
        expect(tierSelectLookupField.isLookup).toBe(true);
        expect(tierSelectLookupField.isConditionalLookup).toBe(true);
        expect(tierSelectLookupField.isComputed).toBe(true);
        expect(tierSelectLookupField.isMultipleCellValue).toBe(true);
        expect(tierSelectLookupField.options).toEqual(beforeRename.options);
        expect(tierSelectLookupField.lookupOptions).toMatchObject(
          beforeRename.lookupOptions as Record<string, unknown>
        );

        const record = await getRecord(host.id, hostRow1Id);
        const tiers = record.fields[tierSelectLookupField.id] as Array<string | { name?: string }>;
        expect(Array.isArray(tiers)).toBe(true);
        const tierNames = tiers
          .map((tier) => (typeof tier === 'string' ? tier : tier.name))
          .filter((name): name is string => Boolean(name))
          .sort();
        expect(tierNames).toEqual(['Basic', 'Enterprise', 'Pro', 'Pro'].sort());
      } finally {
        tierSelectLookupField = await convertField(host.id, fieldId, {
          name: originalName,
          type: FieldType.SingleSelect,
          isLookup: true,
          isConditionalLookup: true,
          options: beforeRename.options,
          lookupOptions: beforeRename.lookupOptions as ILookupOptionsRo,
        } as IFieldRo);
      }
    });

    it('should preserve computed metadata when renaming text conditional lookups via convertField', async () => {
      const beforeRename = await getField(host.id, tagAllLookupField.id);
      expect(beforeRename.dbFieldType).toBe(DbFieldType.Json);
      expect(beforeRename.isMultipleCellValue).toBe(true);
      expect(beforeRename.isComputed).toBe(true);
      expect(beforeRename.lookupOptions).toBeDefined();

      const originalName = beforeRename.name;
      const fieldId = tagAllLookupField.id;
      const recordBefore = await getRecord(host.id, hostRow1Id);
      const baseline = recordBefore.fields[fieldId];

      try {
        tagAllLookupField = await convertField(host.id, fieldId, {
          name: 'Tag All Names Renamed',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          options: beforeRename.options,
          lookupOptions: beforeRename.lookupOptions as ILookupOptionsRo,
        } as IFieldRo);

        expect(tagAllLookupField.name).toBe('Tag All Names Renamed');
        expect(tagAllLookupField.dbFieldType).toBe(DbFieldType.Json);
        expect(tagAllLookupField.isLookup).toBe(true);
        expect(tagAllLookupField.isConditionalLookup).toBe(true);
        expect(tagAllLookupField.isComputed).toBe(true);
        expect(tagAllLookupField.isMultipleCellValue).toBe(true);
        expect(tagAllLookupField.options).toEqual(beforeRename.options);
        expect(tagAllLookupField.lookupOptions).toMatchObject(
          beforeRename.lookupOptions as Record<string, unknown>
        );

        const recordAfter = await getRecord(host.id, hostRow1Id);
        expect(recordAfter.fields[fieldId]).toEqual(baseline);
      } finally {
        tagAllLookupField = await convertField(host.id, fieldId, {
          name: originalName,
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          options: beforeRename.options,
          lookupOptions: beforeRename.lookupOptions as ILookupOptionsRo,
        } as IFieldRo);
      }
    });

    it('should retain computed metadata when renaming and updating lookup formatting via convertField', async () => {
      const beforeUpdate = await getField(host.id, currencyScoreLookupField.id);
      expect(beforeUpdate.dbFieldType).toBe(DbFieldType.Json);
      const fieldId = currencyScoreLookupField.id;
      const originalName = beforeUpdate.name;
      const recordBefore = await getRecord(host.id, hostRow1Id);
      const baseline = recordBefore.fields[fieldId];
      const originalOptions = beforeUpdate.options as {
        formatting?: { type: NumberFormattingType; symbol?: string; precision?: number };
      };
      const updatedOptions = {
        ...originalOptions,
        formatting: {
          type: NumberFormattingType.Currency,
          symbol: '$',
          precision: 0,
        },
      };

      try {
        currencyScoreLookupField = await convertField(host.id, fieldId, {
          name: `${originalName} Renamed`,
          type: FieldType.Number,
          isLookup: true,
          isConditionalLookup: true,
          options: updatedOptions,
          lookupOptions: beforeUpdate.lookupOptions as ILookupOptionsRo,
        } as IFieldRo);

        expect(currencyScoreLookupField.name).toBe(`${originalName} Renamed`);
        expect(currencyScoreLookupField.dbFieldType).toBe(beforeUpdate.dbFieldType);
        expect(currencyScoreLookupField.isComputed).toBe(true);
        expect(currencyScoreLookupField.isMultipleCellValue).toBe(true);
        expect((currencyScoreLookupField.options as typeof updatedOptions).formatting).toEqual(
          updatedOptions.formatting
        );

        const recordAfter = await getRecord(host.id, hostRow1Id);
        expect(recordAfter.fields[fieldId]).toEqual(baseline);
      } finally {
        currencyScoreLookupField = await convertField(host.id, fieldId, {
          name: originalName,
          type: FieldType.Number,
          isLookup: true,
          isConditionalLookup: true,
          options: originalOptions,
          lookupOptions: beforeUpdate.lookupOptions as ILookupOptionsRo,
        } as IFieldRo);
      }
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
    let supplierBRecordId: string;
    let subscriptionProductId: string;

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
      supplierBRecordId = suppliers.records.find(
        (record) => record.fields.SupplierName === 'Supplier B'
      )!.id;

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
      subscriptionProductId = products.records.find(
        (record) => record.fields.ProductName === 'Subscription'
      )!.id;

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

    it('should refresh conditional rollup mirrors when source aggregates gain new matches', async () => {
      const baselineHost = await getRecord(host.id, host.records[0].id);
      const baselineRollupValues = [
        ...((baselineHost.fields[conditionalRollupMirrorField.id] as number[]) || []),
      ];
      const baselineLookupValues = [
        ...((baselineHost.fields[conditionalLookupMirrorField.id] as number[]) || []),
      ];
      expect(baselineRollupValues).toEqual([5, 4]);
      expect(baselineLookupValues).toEqual([5, 4]);

      const baselineProduct = await getRecord(products.id, subscriptionProductId);
      const baselineRollup = baselineProduct.fields[supplierRatingConditionalRollup.id] as
        | number
        | null
        | undefined;
      expect(baselineRollup ?? 0).toBe(0);

      await updateRecordByApi(suppliers.id, supplierBRecordId, supplierRatingId, 5);

      const afterBoostHost = await getRecord(host.id, host.records[0].id);
      const rollupValues =
        (afterBoostHost.fields[conditionalRollupMirrorField.id] as number[]) || [];
      const lookupValues =
        (afterBoostHost.fields[conditionalLookupMirrorField.id] as number[]) || [];
      const baselineFiveRollupCount = baselineRollupValues.filter((value) => value === 5).length;
      const baselineFiveLookupCount = baselineLookupValues.filter((value) => value === 5).length;
      expect(rollupValues.filter((value) => value === 5).length).toBeGreaterThan(
        baselineFiveRollupCount
      );
      expect(lookupValues.filter((value) => value === 5).length).toBeGreaterThan(
        baselineFiveLookupCount
      );

      const subscriptionAfterBoost = await getRecord(products.id, subscriptionProductId);
      expect(subscriptionAfterBoost.fields[supplierRatingConditionalRollup.id]).toEqual(5);

      await updateRecordByApi(suppliers.id, supplierBRecordId, supplierRatingId, 4);

      const restoredHost = await getRecord(host.id, host.records[0].id);
      const restoredRollupValues =
        (restoredHost.fields[conditionalRollupMirrorField.id] as number[]) || [];
      const restoredLookupValues =
        (restoredHost.fields[conditionalLookupMirrorField.id] as number[]) || [];
      expect(restoredRollupValues.filter((value) => value > 0)).toEqual(
        baselineRollupValues.filter((value) => value > 0)
      );
      expect(restoredLookupValues.filter((value) => value > 0)).toEqual(
        baselineLookupValues.filter((value) => value > 0)
      );

      const subscriptionRestored = await getRecord(products.id, subscriptionProductId);
      const restoredRollup = subscriptionRestored.fields[supplierRatingConditionalRollup.id] as
        | number
        | null
        | undefined;
      expect(restoredRollup ?? 0).toBe(baselineRollup ?? 0);
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

  describe('sort dependency edge cases', () => {
    it('updates results when the sort field is converted through the API', async () => {
      let foreign: ITableFullVo | undefined;
      let host: ITableFullVo | undefined;

      try {
        foreign = await createTable(baseId, {
          name: 'ConditionalLookup_SortConvert_Foreign',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'RawScore', type: FieldType.Number } as IFieldRo,
            { name: 'Bonus', type: FieldType.Number } as IFieldRo,
            { name: 'EffectiveScore', type: FieldType.Number } as IFieldRo,
          ],
          records: [
            {
              fields: {
                Title: 'Alpha',
                Status: 'Active',
                RawScore: 70,
                Bonus: 0,
                EffectiveScore: 70,
              },
            },
            {
              fields: {
                Title: 'Beta',
                Status: 'Active',
                RawScore: 90,
                Bonus: -60,
                EffectiveScore: 90,
              },
            },
            {
              fields: {
                Title: 'Gamma',
                Status: 'Active',
                RawScore: 40,
                Bonus: 0,
                EffectiveScore: 40,
              },
            },
          ],
        });

        const titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
        const statusId = foreign.fields.find((field) => field.name === 'Status')!.id;
        const rawScoreId = foreign.fields.find((field) => field.name === 'RawScore')!.id;
        const bonusId = foreign.fields.find((field) => field.name === 'Bonus')!.id;
        const effectiveScoreId = foreign.fields.find(
          (field) => field.name === 'EffectiveScore'
        )!.id;

        host = await createTable(baseId, {
          name: 'ConditionalLookup_SortConvert_Host',
          fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { StatusFilter: 'Active' } }],
        });
        const statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;
        const activeRecordId = host.records[0].id;

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

        const lookupField = await createField(host.id, {
          name: 'Converted Sort Lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            filter: statusMatchFilter,
            sort: { fieldId: effectiveScoreId, order: SortFunc.Desc },
            limit: 2,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const baseline = await getRecord(host.id, activeRecordId);
        expect(baseline.fields[lookupField.id]).toEqual(['Beta', 'Alpha']);

        await convertField(foreign.id, effectiveScoreId, {
          name: 'EffectiveScore',
          type: FieldType.Formula,
          options: {
            expression: `{${rawScoreId}} + {${bonusId}}`,
          },
        } as IFieldRo);

        const refreshed = await getRecord(host.id, activeRecordId);
        expect(refreshed.fields[lookupField.id]).toEqual(['Alpha', 'Gamma']);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        if (foreign) {
          await permanentDeleteTable(baseId, foreign.id);
        }
      }
    });

    it('keeps only the limit after the sort field is deleted', async () => {
      let foreign: ITableFullVo | undefined;
      let host: ITableFullVo | undefined;

      try {
        foreign = await createTable(baseId, {
          name: 'ConditionalLookup_DeleteSort_Foreign',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'EffectiveScore', type: FieldType.Number } as IFieldRo,
          ],
          records: [
            { fields: { Title: 'Alpha', Status: 'Active', EffectiveScore: 70 } },
            { fields: { Title: 'Beta', Status: 'Active', EffectiveScore: 90 } },
            { fields: { Title: 'Gamma', Status: 'Active', EffectiveScore: 40 } },
            { fields: { Title: 'Delta', Status: 'Closed', EffectiveScore: 100 } },
          ],
        });

        const titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
        const statusId = foreign.fields.find((field) => field.name === 'Status')!.id;
        const effectiveScoreId = foreign.fields.find(
          (field) => field.name === 'EffectiveScore'
        )!.id;

        host = await createTable(baseId, {
          name: 'ConditionalLookup_DeleteSort_Host',
          fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { StatusFilter: 'Active' } }],
        });
        const statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;
        const activeRecordId = host.records[0].id;

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

        const lookupField = await createField(host.id, {
          name: 'Limit Without Sort Lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            filter: statusMatchFilter,
            sort: { fieldId: effectiveScoreId, order: SortFunc.Desc },
            limit: 2,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const baseline = await getRecord(host.id, activeRecordId);
        expect(baseline.fields[lookupField.id]).toEqual(['Beta', 'Alpha']);

        await deleteField(foreign.id, effectiveScoreId);

        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Closed');
        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Active');

        const refreshedRecord = await getRecord(host.id, activeRecordId);
        const refreshedValue = refreshedRecord.fields[lookupField.id] as
          | string[]
          | null
          | undefined;
        if (Array.isArray(refreshedValue)) {
          expect(refreshedValue.length).toBeLessThanOrEqual(2);
          expect(refreshedValue).not.toContain('Delta');
        } else {
          expect(refreshedValue == null).toBe(true);
        }
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        if (foreign) {
          await permanentDeleteTable(baseId, foreign.id);
        }
      }
    });
  });

  describe('conditional rollup filters referencing host titles', () => {
    let tableA: ITableFullVo;
    let tableB: ITableFullVo;
    let tableATitleFieldId: string;
    let tableBTitleFieldId: string;
    let tableAFirstAlphaRecordId: string;
    let tableABetaRecordId: string;
    let tableASecondAlphaRecordId: string;
    let tableBAlphaRecordId: string;
    let tableBGammaRecordId: string;
    let tableBConditionalRollupField: IFieldVo;
    let tableASelfConditionalRollupField: IFieldVo;

    beforeAll(async () => {
      tableA = await createTable(baseId, {
        name: 'ConditionalLookup_TitleMatch_Primary',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Title: 'Alpha' } },
          { fields: { Title: 'Beta' } },
          { fields: { Title: 'Alpha' } },
        ],
      });
      tableATitleFieldId = tableA.fields.find((field) => field.name === 'Title')!.id;
      tableAFirstAlphaRecordId = tableA.records[0].id;
      tableABetaRecordId = tableA.records[1].id;
      tableASecondAlphaRecordId = tableA.records[2].id;

      tableB = await createTable(baseId, {
        name: 'ConditionalLookup_TitleMatch_Secondary',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'Alpha' } }, { fields: { Title: 'Gamma' } }],
      });
      tableBTitleFieldId = tableB.fields.find((field) => field.name === 'Title')!.id;
      tableBAlphaRecordId = tableB.records[0].id;
      tableBGammaRecordId = tableB.records[1].id;

      const matchPrimaryTitleFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: tableATitleFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: tableBTitleFieldId },
          },
        ],
      };

      tableBConditionalRollupField = await createField(tableB.id, {
        name: 'Matching Primary Titles',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: tableA.id,
          lookupFieldId: tableATitleFieldId,
          expression: 'count({values})',
          filter: matchPrimaryTitleFilter,
        },
      } as IFieldRo);

      const selfTitleFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: tableATitleFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: tableATitleFieldId },
          },
        ],
      };

      tableASelfConditionalRollupField = await createField(tableA.id, {
        name: 'Self Title Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: tableA.id,
          lookupFieldId: tableATitleFieldId,
          expression: 'count({values})',
          filter: selfTitleFilter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, tableB.id);
      await permanentDeleteTable(baseId, tableA.id);
    });

    it('aggregates foreign matches when filter ties titles to host fields', async () => {
      const tableBRecords = await getRecords(tableB.id, { fieldKeyType: FieldKeyType.Id });
      const alphaRecord = tableBRecords.records.find(
        (record) => record.id === tableBAlphaRecordId
      )!;
      const gammaRecord = tableBRecords.records.find(
        (record) => record.id === tableBGammaRecordId
      )!;

      expect(alphaRecord.fields[tableBConditionalRollupField.id]).toEqual(2);
      expect(gammaRecord.fields[tableBConditionalRollupField.id]).toEqual(0);
    });

    it('aggregates self-table matches when foreign scope equals host table', async () => {
      const tableARecords = await getRecords(tableA.id, { fieldKeyType: FieldKeyType.Id });
      const firstAlpha = tableARecords.records.find(
        (record) => record.id === tableAFirstAlphaRecordId
      )!;
      const betaRecord = tableARecords.records.find((record) => record.id === tableABetaRecordId)!;
      const secondAlpha = tableARecords.records.find(
        (record) => record.id === tableASecondAlphaRecordId
      )!;

      expect(firstAlpha.fields[tableASelfConditionalRollupField.id]).toEqual(2);
      expect(secondAlpha.fields[tableASelfConditionalRollupField.id]).toEqual(2);
      expect(betaRecord.fields[tableASelfConditionalRollupField.id]).toEqual(1);
    });
  });

  describe('circular dependency detection', () => {
    it('rejects converting a conditional lookup that would introduce a cycle', async () => {
      let alpha: ITableFullVo | undefined;
      let beta: ITableFullVo | undefined;
      let betaLookup: IFieldVo | undefined;
      let alphaRollup: IFieldVo | undefined;

      try {
        alpha = await createTable(baseId, {
          name: 'ConditionalLookup_Cycle_Alpha',
          fields: [
            { name: 'Alpha Key', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Alpha Value', type: FieldType.Number } as IFieldRo,
          ],
          records: [
            { fields: { 'Alpha Key': 'A', 'Alpha Value': 10 } },
            { fields: { 'Alpha Key': 'B', 'Alpha Value': 20 } },
          ],
        });
        const alphaKeyId = alpha.fields.find((field) => field.name === 'Alpha Key')!.id;
        const alphaValueId = alpha.fields.find((field) => field.name === 'Alpha Value')!.id;

        beta = await createTable(baseId, {
          name: 'ConditionalLookup_Cycle_Beta',
          fields: [
            { name: 'Beta Key', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Beta Quantity', type: FieldType.Number } as IFieldRo,
          ],
          records: [
            { fields: { 'Beta Key': 'A', 'Beta Quantity': 1 } },
            { fields: { 'Beta Key': 'B', 'Beta Quantity': 2 } },
          ],
        });
        const betaKeyId = beta.fields.find((field) => field.name === 'Beta Key')!.id;

        const matchFilter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: alphaKeyId,
              operator: 'is',
              value: { type: 'field', fieldId: betaKeyId },
            },
          ],
        };

        betaLookup = await createField(beta.id, {
          name: 'Alpha Values Lookup',
          type: FieldType.Number,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: alpha.id,
            lookupFieldId: alphaValueId,
            filter: matchFilter,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const rollupFilter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: betaKeyId,
              operator: 'is',
              value: { type: 'field', fieldId: alphaKeyId },
            },
          ],
        };

        alphaRollup = await createField(alpha.id, {
          name: 'Beta Lookup Count',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: beta.id,
            lookupFieldId: betaLookup.id,
            expression: 'count({values})',
            filter: rollupFilter,
          },
        } as IFieldRo);

        await convertField(
          beta.id,
          betaLookup.id,
          {
            name: 'Alpha Values Lookup',
            type: FieldType.ConditionalRollup,
            isLookup: true,
            isConditionalLookup: true,
            lookupOptions: {
              foreignTableId: alpha.id,
              lookupFieldId: alphaRollup.id,
              filter: matchFilter,
            } as ILookupOptionsRo,
          } as IFieldRo,
          400
        );

        const lookupAfterFailure = await getField(beta.id, betaLookup.id);
        expect((lookupAfterFailure.lookupOptions as ILookupOptionsRo).lookupFieldId).toBe(
          alphaValueId
        );
      } finally {
        if (beta) {
          await permanentDeleteTable(baseId, beta.id);
        }
        if (alpha) {
          await permanentDeleteTable(baseId, alpha.id);
        }
      }
    });
  });

  describe('user field filters', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let lookupField: IFieldVo;
    let titleId: string;
    let foreignOwnerId: string;
    let hostOwnerId: string;
    let assignedRecordId: string;
    let emptyRecordId: string;

    beforeAll(async () => {
      const { userId, userName, email } = globalThis.testConfig;
      const userCell = { id: userId, title: userName, email };

      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_User_Foreign',
        fields: [
          { name: 'Task', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Owner', type: FieldType.User } as IFieldRo,
        ],
        records: [
          { fields: { Task: 'Task Alpha', Owner: userCell } },
          { fields: { Task: 'Task Beta' } },
          { fields: { Task: 'Task Gamma', Owner: userCell } },
        ],
      });

      titleId = foreign.fields.find((field) => field.name === 'Task')!.id;
      foreignOwnerId = foreign.fields.find((field) => field.name === 'Owner')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_User_Host',
        fields: [{ name: 'Assigned', type: FieldType.User } as IFieldRo],
        records: [{ fields: { Assigned: userCell } }, { fields: {} }],
      });

      hostOwnerId = host.fields.find((field) => field.name === 'Assigned')!.id;
      assignedRecordId = host.records[0].id;
      emptyRecordId = host.records[1].id;

      const ownerMatchFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: foreignOwnerId,
            operator: 'is',
            value: { type: 'field', fieldId: hostOwnerId },
          },
        ],
      };

      lookupField = await createField(host.id, {
        name: 'Owned Tasks',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter: ownerMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should create conditional lookup filtered by matching users', async () => {
      expect(lookupField.id).toBeDefined();

      const assignedRecord = await getRecord(host.id, assignedRecordId);
      const ownedTasks = [...((assignedRecord.fields[lookupField.id] as string[]) ?? [])].sort();
      expect(ownedTasks).toEqual(['Task Alpha', 'Task Gamma']);

      const emptyRecord = await getRecord(host.id, emptyRecordId);
      expect((emptyRecord.fields[lookupField.id] as string[] | undefined) ?? []).toEqual([]);
    });
  });

  describe('field reference compatibility validation', () => {
    it('marks lookup field as errored when reference field type changes', async () => {
      const { userId, userName, email } = globalThis.testConfig;
      const userCell = { id: userId, title: userName, email };

      const foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Compatibility_Foreign',
        fields: [
          { name: 'Task', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Owner', type: FieldType.User } as IFieldRo,
        ],
        records: [
          { fields: { Task: 'Task Alpha', Owner: userCell } },
          { fields: { Task: 'Task Beta' } },
        ],
      });
      const foreignTaskId = foreign.fields.find((field) => field.name === 'Task')!.id;
      const foreignOwnerId = foreign.fields.find((field) => field.name === 'Owner')!.id;

      const host = await createTable(baseId, {
        name: 'ConditionalLookup_Compatibility_Host',
        fields: [{ name: 'Assigned', type: FieldType.User } as IFieldRo],
        records: [{ fields: { Assigned: userCell } }],
      });
      const hostOwnerId = host.fields.find((field) => field.name === 'Assigned')!.id;

      try {
        const ownerMatchFilter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: foreignOwnerId,
              operator: 'is',
              value: { type: 'field', fieldId: hostOwnerId },
            },
          ],
        };

        const lookupField = await createField(host.id, {
          name: 'Owned Tasks',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignTaskId,
            filter: ownerMatchFilter,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const initialLookup = await getField(host.id, lookupField.id);
        expect(initialLookup.hasError).toBeFalsy();

        await convertField(host.id, hostOwnerId, {
          name: 'Assigned',
          type: FieldType.SingleLineText,
          options: {},
        } as IFieldRo);

        const erroredLookup = await getField(host.id, lookupField.id);
        expect(erroredLookup.hasError).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, host.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('marks lookup field as errored when foreign field type changes', async () => {
      const { userId, userName, email } = globalThis.testConfig;
      const userCell = { id: userId, title: userName, email };

      const foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Compatibility_ForeignKey',
        fields: [
          { name: 'Task', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Owner', type: FieldType.User } as IFieldRo,
        ],
        records: [
          { fields: { Task: 'Task Alpha', Owner: userCell } },
          { fields: { Task: 'Task Beta', Owner: userCell } },
        ],
      });
      const foreignTaskId = foreign.fields.find((field) => field.name === 'Task')!.id;
      const foreignOwnerId = foreign.fields.find((field) => field.name === 'Owner')!.id;

      const host = await createTable(baseId, {
        name: 'ConditionalLookup_Compatibility_HostKey',
        fields: [{ name: 'Assigned', type: FieldType.User } as IFieldRo],
        records: [{ fields: { Assigned: userCell } }],
      });
      const hostOwnerId = host.fields.find((field) => field.name === 'Assigned')!.id;

      try {
        const ownerMatchFilter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: foreignOwnerId,
              operator: 'is',
              value: { type: 'field', fieldId: hostOwnerId },
            },
          ],
        };

        const lookupField = await createField(host.id, {
          name: 'Owned Tasks',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignTaskId,
            filter: ownerMatchFilter,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const initialLookup = await getField(host.id, lookupField.id);
        expect(initialLookup.hasError).toBeFalsy();

        await convertField(foreign.id, foreignOwnerId, {
          name: 'Owner',
          type: FieldType.SingleLineText,
          options: {},
        } as IFieldRo);

        const erroredLookup = await getField(host.id, lookupField.id);
        expect(erroredLookup.hasError).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, host.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });

  describe('numeric array field reference filters', () => {
    let games: ITableFullVo;
    let summary: ITableFullVo;
    let roundScoresField: IFieldVo;
    let gamesLinkFieldId: string;
    let thresholdFieldId: string;
    let ceilingFieldId: string;
    let targetFieldId: string;
    let exactFieldId: string;
    let excludeFieldId: string;
    let aliceSummaryId: string;
    let bobSummaryId: string;
    let scoresAboveThresholdField: IFieldVo;
    let scoresWithinCeilingField: IFieldVo;
    let scoresEqualTargetField: IFieldVo;
    let scoresNotExactField: IFieldVo;
    let scoresWithoutExcludedField: IFieldVo;

    beforeAll(async () => {
      games = await createTable(baseId, {
        name: 'ConditionalLookup_NumberArray_Games',
        fields: [
          { name: 'Player', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Player: 'Alice', Score: 10 } },
          { fields: { Player: 'Alice', Score: 12 } },
          { fields: { Player: 'Bob', Score: 7 } },
        ],
      });
      const scoreFieldId = games.fields.find((f) => f.name === 'Score')!.id;

      const gamePlayerFieldId = games.fields.find((f) => f.name === 'Player')!.id;

      summary = await createTable(baseId, {
        name: 'ConditionalLookup_NumberArray_Summary',
        fields: [
          { name: 'Player', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Games',
            type: FieldType.Link,
            options: {
              foreignTableId: games.id,
              relationship: Relationship.ManyMany,
            },
          } as IFieldRo,
          { name: 'Threshold', type: FieldType.Number } as IFieldRo,
          { name: 'Ceiling', type: FieldType.Number } as IFieldRo,
          { name: 'Target', type: FieldType.Number } as IFieldRo,
          { name: 'Exact', type: FieldType.Number } as IFieldRo,
          { name: 'Exclude', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Player: 'Alice',
              Games: [{ id: games.records[0].id }, { id: games.records[1].id }],
              Threshold: 11,
              Ceiling: 12,
              Target: 12,
              Exact: 12,
              Exclude: 10,
            },
          },
          {
            fields: {
              Player: 'Bob',
              Games: [{ id: games.records[2].id }],
              Threshold: 8,
              Ceiling: 8,
              Target: 9,
              Exact: 7,
              Exclude: 5,
            },
          },
        ],
      });

      gamesLinkFieldId = summary.fields.find((f) => f.name === 'Games')!.id;
      const summaryPlayerFieldId = summary.fields.find((f) => f.name === 'Player')!.id;
      roundScoresField = await createField(summary.id, {
        name: 'Round Scores',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          linkFieldId: gamesLinkFieldId,
        } as ILookupOptionsRo,
      } as IFieldRo);
      thresholdFieldId = summary.fields.find((f) => f.name === 'Threshold')!.id;
      ceilingFieldId = summary.fields.find((f) => f.name === 'Ceiling')!.id;
      targetFieldId = summary.fields.find((f) => f.name === 'Target')!.id;
      exactFieldId = summary.fields.find((f) => f.name === 'Exact')!.id;
      excludeFieldId = summary.fields.find((f) => f.name === 'Exclude')!.id;
      aliceSummaryId = summary.records[0].id;
      bobSummaryId = summary.records[1].id;

      const scoresAboveThresholdFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: gamePlayerFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: summaryPlayerFieldId },
          },
          {
            fieldId: scoreFieldId,
            operator: 'isGreater',
            value: { type: 'field', fieldId: thresholdFieldId },
          },
        ],
      };
      scoresAboveThresholdField = await createField(summary.id, {
        name: 'Scores Above Threshold',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          filter: scoresAboveThresholdFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const scoresWithinCeilingFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: gamePlayerFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: summaryPlayerFieldId },
          },
          {
            fieldId: scoreFieldId,
            operator: 'isLessEqual',
            value: { type: 'field', fieldId: ceilingFieldId },
          },
        ],
      };
      scoresWithinCeilingField = await createField(summary.id, {
        name: 'Scores Within Ceiling',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          filter: scoresWithinCeilingFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const equalTargetFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: gamePlayerFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: summaryPlayerFieldId },
          },
          {
            fieldId: scoreFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: targetFieldId },
          },
        ],
      };
      scoresEqualTargetField = await createField(summary.id, {
        name: 'Scores Equal Target',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          filter: equalTargetFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const notExactFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: gamePlayerFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: summaryPlayerFieldId },
          },
          {
            fieldId: scoreFieldId,
            operator: 'isNot',
            value: { type: 'field', fieldId: exactFieldId },
          },
        ],
      };
      scoresNotExactField = await createField(summary.id, {
        name: 'Scores Not Exact',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          filter: notExactFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const withoutExcludedFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: gamePlayerFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: summaryPlayerFieldId },
          },
          {
            fieldId: scoreFieldId,
            operator: 'isNot',
            value: { type: 'field', fieldId: excludeFieldId },
          },
        ],
      };
      scoresWithoutExcludedField = await createField(summary.id, {
        name: 'Scores Without Excluded',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          filter: withoutExcludedFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, summary.id);
      await permanentDeleteTable(baseId, games.id);
    });

    it('filters numeric lookup arrays using field references', async () => {
      const records = await getRecords(summary.id, { fieldKeyType: FieldKeyType.Id });
      const aliceSummary = records.records.find((record) => record.id === aliceSummaryId)!;
      const bobSummary = records.records.find((record) => record.id === bobSummaryId)!;

      expect(aliceSummary.fields[scoresAboveThresholdField.id]).toEqual([12]);
      expect(
        (bobSummary.fields[scoresAboveThresholdField.id] as number[] | undefined) ?? []
      ).toEqual([]);

      expect(aliceSummary.fields[scoresWithinCeilingField.id]).toEqual([10, 12]);
      expect(bobSummary.fields[scoresWithinCeilingField.id]).toEqual([7]);

      expect(aliceSummary.fields[scoresEqualTargetField.id]).toEqual([12]);
      expect((bobSummary.fields[scoresEqualTargetField.id] as number[] | undefined) ?? []).toEqual(
        []
      );

      expect((aliceSummary.fields[scoresNotExactField.id] as number[] | undefined) ?? []).toEqual([
        10,
      ]);
      expect((bobSummary.fields[scoresNotExactField.id] as number[] | undefined) ?? []).toEqual([]);

      expect(aliceSummary.fields[scoresWithoutExcludedField.id]).toEqual([12]);
      expect(bobSummary.fields[scoresWithoutExcludedField.id]).toEqual([7]);
    });
  });

  describe('limit enforcement', () => {
    const limitCap = Number(process.env.CONDITIONAL_QUERY_MAX_LIMIT ?? '5000');
    const totalActive = limitCap + 2;
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let titleId: string;
    let statusId: string;
    let statusFilterId: string;
    let lookupFieldId: string;
    const activeTitles = Array.from({ length: totalActive }, (_, idx) => `Active ${idx + 1}`);

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalLookup_Limit_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText, options: {} } as IFieldRo,
        ],
        records: [
          ...activeTitles.map((title) => ({
            fields: { Title: title, Status: 'Active' },
          })),
          { fields: { Title: 'Closed Item', Status: 'Closed' } },
        ],
      });
      titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
      statusId = foreign.fields.find((field) => field.name === 'Status')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalLookup_Limit_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText, options: {} } as IFieldRo],
        records: [{ fields: { StatusFilter: 'Active' } }],
      });
      statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('rejects creating a conditional lookup with limit beyond configured maximum', async () => {
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

      await createField(
        host.id,
        {
          name: 'TooManyRecords',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            filter: statusMatchFilter,
            limit: limitCap + 1,
          } as ILookupOptionsRo,
        } as IFieldRo,
        400
      );
    });

    it('caps resolved lookup results to the maximum limit when limit is omitted', async () => {
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

      const lookupField = await createField(host.id, {
        name: 'Limited Titles',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          filter: statusMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);
      lookupFieldId = lookupField.id;

      const record = await getRecord(host.id, host.records[0].id);
      const values = record.fields[lookupFieldId] as string[];
      expect(Array.isArray(values)).toBe(true);
      expect(values.length).toBe(limitCap);
      expect(values).toEqual(activeTitles.slice(0, limitCap));
      expect(values).not.toContain(activeTitles[limitCap]);
    });
  });
});
