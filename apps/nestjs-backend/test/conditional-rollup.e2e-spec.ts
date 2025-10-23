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
  IFilter,
  IFilterItem,
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
  SortFunc,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createBase,
  createField,
  convertField,
  createRecords,
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

  describe('expression coverage', () => {
    const setupConditionalRollupFixtures = async () => {
      const foreign = await createTable(baseId, {
        name: 'ConditionalRollupExpr_Foreign',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          { name: 'Flag', type: FieldType.Checkbox } as IFieldRo,
        ],
        records: [
          { fields: { Label: 'Alpha', Amount: 10, Flag: true } },
          { fields: { Label: 'Alpha', Amount: null, Flag: true } },
          { fields: { Label: 'Beta', Amount: 20, Flag: true } },
        ],
      });

      const host = await createTable(baseId, {
        name: 'ConditionalRollupExpr_Host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Name: 'Host Row' } }],
      });

      const linkField = await createField(host.id, {
        name: 'Links',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: foreign.id,
        },
      } as IFieldRo);

      const hostRecordId = host.records[0].id;
      await updateRecordByApi(host.id, hostRecordId, linkField.id, [
        { id: foreign.records[0].id },
        { id: foreign.records[1].id },
        { id: foreign.records[2].id },
      ]);

      const labelId = foreign.fields.find((field) => field.name === 'Label')!.id;
      const amountId = foreign.fields.find((field) => field.name === 'Amount')!.id;
      const flagId = foreign.fields.find((field) => field.name === 'Flag')!.id;
      return { foreign, host, linkField, hostRecordId, labelId, amountId, flagId };
    };

    const conditionalRollupCases: Array<{
      expression: string;
      lookupFieldKey: 'labelId' | 'amountId' | 'flagId';
      expected: unknown;
    }> = [
      { expression: 'countall({values})', lookupFieldKey: 'amountId', expected: 3 },
      { expression: 'counta({values})', lookupFieldKey: 'labelId', expected: 3 },
      { expression: 'count({values})', lookupFieldKey: 'amountId', expected: 2 },
      { expression: 'sum({values})', lookupFieldKey: 'amountId', expected: 30 },
      { expression: 'average({values})', lookupFieldKey: 'amountId', expected: 15 },
      { expression: 'max({values})', lookupFieldKey: 'amountId', expected: 20 },
      { expression: 'min({values})', lookupFieldKey: 'amountId', expected: 10 },
      { expression: 'and({values})', lookupFieldKey: 'flagId', expected: true },
      { expression: 'or({values})', lookupFieldKey: 'flagId', expected: true },
      { expression: 'xor({values})', lookupFieldKey: 'flagId', expected: true },
      {
        expression: 'array_join({values})',
        lookupFieldKey: 'labelId',
        expected: 'Alpha, Alpha, Beta',
      },
      {
        expression: 'array_unique({values})',
        lookupFieldKey: 'labelId',
        expected: ['Alpha', 'Beta'],
      },
      {
        expression: 'array_compact({values})',
        lookupFieldKey: 'labelId',
        expected: ['Alpha', 'Alpha', 'Beta'],
      },
      {
        expression: 'concatenate({values})',
        lookupFieldKey: 'labelId',
        expected: 'Alpha, Alpha, Beta',
      },
    ];

    it.each(conditionalRollupCases)(
      'should support conditional rollup expression %s without filters',
      async ({ expression, lookupFieldKey, expected }) => {
        let fixtures: Awaited<ReturnType<typeof setupConditionalRollupFixtures>> | undefined;
        try {
          fixtures = await setupConditionalRollupFixtures();
          const { foreign, host, linkField, hostRecordId } = fixtures;
          const lookupFieldId = fixtures[lookupFieldKey];

          const field = await createField(host.id, {
            name: `conditional rollup ${expression}`,
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: foreign.id,
              lookupFieldId,
              expression,
              filter: {
                conjunction: 'and',
                filterSet: [
                  {
                    fieldId: fixtures.labelId,
                    operator: 'isNotEmpty',
                    value: null,
                  },
                ],
              },
            },
          } as IFieldRo);

          const record = await getRecord(host.id, hostRecordId);
          const value = record.fields[field.id];

          if (Array.isArray(expected)) {
            expect(Array.isArray(value)).toBe(true);
            const sortedExpected = [...expected].sort();
            const sortedValue = [...(value as unknown[])].sort();
            expect(sortedValue).toEqual(sortedExpected);
          } else if (typeof expected === 'string') {
            if (expected.includes(', ')) {
              expect((value as string).split(', ').sort()).toEqual(expected.split(', ').sort());
            } else {
              expect(value).toEqual(expected);
            }
          } else {
            expect(value).toEqual(expected);
          }
        } finally {
          if (fixtures?.host) {
            await permanentDeleteTable(baseId, fixtures.host.id);
          }
          if (fixtures?.foreign) {
            await permanentDeleteTable(baseId, fixtures.foreign.id);
          }
        }
      }
    );
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

  describe('limit enforcement', () => {
    const limitCap = Number(process.env.CONDITIONAL_QUERY_MAX_LIMIT ?? '5000');
    const totalActive = limitCap + 3;
    const activeTitles = Array.from({ length: totalActive }, (_, idx) => `Score ${idx + 1}`);
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let titleId: string;
    let statusId: string;
    let scoreId: string;
    let statusFilterId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Limit_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          ...activeTitles.map((title, idx) => ({
            fields: { Title: title, Status: 'Active', Score: idx + 1 },
          })),
          { fields: { Title: 'Closed Item', Status: 'Closed', Score: 999 } },
        ],
      });
      titleId = foreign.fields.find((field) => field.name === 'Title')!.id;
      statusId = foreign.fields.find((field) => field.name === 'Status')!.id;
      scoreId = foreign.fields.find((field) => field.name === 'Score')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalRollup_Limit_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { StatusFilter: 'Active' } }],
      });
      statusFilterId = host.fields.find((field) => field.name === 'StatusFilter')!.id;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('rejects creating conditional rollups with limit above the configured cap', async () => {
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
          name: 'TooManyRollupValues',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            expression: 'array_compact({values})',
            filter: statusMatchFilter,
            sort: { fieldId: scoreId, order: SortFunc.Asc },
            limit: limitCap + 1,
          } as IConditionalRollupFieldOptions,
        } as IFieldRo,
        400
      );
    });

    it('caps array aggregation results to the configured maximum when limit is omitted', async () => {
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

      const rollupField = await createField(host.id, {
        name: 'Limited Titles Rollup',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          expression: 'array_compact({values})',
          filter: statusMatchFilter,
          sort: { fieldId: scoreId, order: SortFunc.Asc },
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);

      const record = await getRecord(host.id, host.records[0].id);
      const values = record.fields[rollupField.id] as string[];
      expect(Array.isArray(values)).toBe(true);
      expect(values.length).toBe(limitCap);
      expect(values).toEqual(activeTitles.slice(0, limitCap));
      expect(values).not.toContain(activeTitles[limitCap]);
    });
  });

  describe('self equality filters', () => {
    it('supports creating records when rollup filters compare against same-table fields', async () => {
      let table: ITableFullVo | undefined;
      const categoryChoices = [
        { id: 'cat-a', name: 'Category A', color: Colors.Blue },
        { id: 'cat-b', name: 'Category B', color: Colors.Green },
      ];

      try {
        table = await createTable(baseId, {
          name: 'ConditionalRollup_Self_Foreign',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Count', type: FieldType.Number } as IFieldRo,
            {
              name: 'Category',
              type: FieldType.SingleSelect,
              options: { choices: categoryChoices },
            } as IFieldRo,
          ],
          records: [
            {
              fields: {
                Title: 'Alpha',
                Count: 1,
                Category: categoryChoices[0].name,
              },
            },
            {
              fields: {
                Title: 'Beta',
                Count: 2,
                Category: categoryChoices[1].name,
              },
            },
            {
              fields: {
                Title: 'Gamma',
                Count: 3,
                Category: categoryChoices[0].name,
              },
            },
          ],
        });

        const titleFieldId = table.fields.find((field) => field.name === 'Title')!.id;
        const countFieldId = table.fields.find((field) => field.name === 'Count')!.id;
        const categoryFieldId = table.fields.find((field) => field.name === 'Category')!.id;

        const linkField = await createField(table.id, {
          name: 'Self Links',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: table.id,
          },
        } as IFieldRo);

        const currentRecordIds = table.records.map((record) => record.id);
        let currentLinkTargets = currentRecordIds.map((id) => ({ id }));

        const syncAllLinks = async () => {
          for (const recordId of currentRecordIds) {
            await updateRecordByApi(table!.id, recordId, linkField.id, currentLinkTargets);
          }
        };

        await syncAllLinks();

        const rollupField = await createField(table.id, {
          name: 'Self Category Count',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: table.id,
            lookupFieldId: categoryFieldId,
            expression: 'count({values})',
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: titleFieldId,
                  operator: 'is',
                  value: { type: 'field', fieldId: titleFieldId, tableId: table.id },
                },
                {
                  fieldId: countFieldId,
                  operator: 'is',
                  value: { type: 'field', fieldId: countFieldId, tableId: table.id },
                },
              ],
            },
          },
        } as IFieldRo);

        const expectRollupValue = async (recordId: string, expected: number) => {
          const record = await getRecord(table!.id, recordId);
          expect(record.fields[rollupField.id]).toEqual(expected);
        };

        for (const recordId of currentRecordIds) {
          await expectRollupValue(recordId, 1);
        }

        const created = await createRecords(table.id, {
          records: [
            {
              fields: {
                [titleFieldId]: 'Delta',
                [countFieldId]: null,
                [categoryFieldId]: categoryChoices[1].name,
              },
            },
          ],
        });
        const newRecordId = created.records[0].id;
        currentRecordIds.push(newRecordId);
        currentLinkTargets = currentRecordIds.map((id) => ({ id }));
        await syncAllLinks();

        await expectRollupValue(newRecordId, 0);

        await updateRecordByApi(table.id, newRecordId, countFieldId, 4);

        await expectRollupValue(newRecordId, 1);

        await updateRecordByApi(table.id, newRecordId, titleFieldId, 'Delta Updated');

        await expectRollupValue(newRecordId, 1);
      } finally {
        if (table) {
          await permanentDeleteTable(baseId, table.id);
        }
      }
    });
  });

  describe('filter option synchronization', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let rollupField: IFieldVo;
    let statusId: string;
    let amountId: string;
    const statusChoices = [
      { id: 'status-active', name: 'Active', color: Colors.Green },
      { id: 'status-closed', name: 'Closed', color: Colors.Gray },
    ];

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Filter_Foreign',
        fields: [
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: { choices: statusChoices },
          } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
      });
      statusId = foreign.fields.find((field) => field.name === 'Status')!.id;
      amountId = foreign.fields.find((field) => field.name === 'Amount')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalRollup_Filter_Host',
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

      rollupField = await createField(host.id, {
        name: 'Active Amount Sum',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'sum({values})',
          filter,
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should update conditional rollup filters when select option names change', async () => {
      await convertField(foreign.id, statusId, {
        name: 'Status',
        type: FieldType.SingleSelect,
        options: {
          choices: [{ ...statusChoices[0], name: 'Active Plus' }, statusChoices[1]],
        },
      } as IFieldRo);

      const refreshed = await getField(host.id, rollupField.id);
      const options = refreshed.options as IConditionalRollupFieldOptions;
      const filterItem = options.filter?.filterSet?.[0] as IFilterItem | undefined;
      expect(filterItem?.value).toBe('Active Plus');
    });
  });

  describe('sort and limit options', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let rollupField: IFieldVo;
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
        name: 'ConditionalRollup_Sort_Foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
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
        name: 'ConditionalRollup_Sort_Host',
        fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
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

      rollupField = await createField(host.id, {
        name: 'Top Titles Rollup',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: titleId,
          expression: 'array_compact({values})',
          filter: statusMatchFilter,
          sort: { fieldId: scoreId, order: SortFunc.Desc },
          limit: 2,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should honor sort and limit for array rollups and react to updates', async () => {
      const originalField = await getField(host.id, rollupField.id);
      const originalOptions = {
        ...(originalField.options as IConditionalRollupFieldOptions),
      };
      const originalName = originalField.name;

      try {
        expect(originalOptions.sort).toEqual({ fieldId: scoreId, order: SortFunc.Desc });
        expect(originalOptions.limit).toBe(2);

        const baselineRecords = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
        const baselineActive = baselineRecords.records.find(
          (record) => record.id === activeRecordId
        )!;
        const baselineClosed = baselineRecords.records.find(
          (record) => record.id === closedRecordId
        )!;
        expect(baselineActive.fields[rollupField.id]).toEqual(['Beta', 'Alpha']);
        expect(baselineClosed.fields[rollupField.id]).toEqual(['Delta']);

        const ascOptions: IConditionalRollupFieldOptions = {
          ...originalOptions,
          sort: { fieldId: scoreId, order: SortFunc.Asc },
          limit: 1,
        };

        rollupField = await convertField(host.id, rollupField.id, {
          name: rollupField.name,
          type: FieldType.ConditionalRollup,
          options: ascOptions,
        } as IFieldRo);

        let activeRecord = await getRecord(host.id, activeRecordId);
        let closedRecord = await getRecord(host.id, closedRecordId);
        expect(activeRecord.fields[rollupField.id]).toEqual(['Gamma']);
        expect(closedRecord.fields[rollupField.id]).toEqual(['Delta']);

        await updateRecordByApi(foreign.id, gammaRecordId, scoreId, 75);
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[rollupField.id]).toEqual(['Alpha']);

        await updateRecordByApi(foreign.id, gammaRecordId, scoreId, 40);
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[rollupField.id]).toEqual(['Gamma']);

        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Closed');
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[rollupField.id]).toEqual(['Delta']);

        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Active');
        activeRecord = await getRecord(host.id, activeRecordId);
        expect(activeRecord.fields[rollupField.id]).toEqual(['Gamma']);

        rollupField = await convertField(host.id, rollupField.id, {
          name: rollupField.name,
          type: FieldType.ConditionalRollup,
          options: {
            ...(rollupField.options as IConditionalRollupFieldOptions),
            sort: undefined,
            limit: undefined,
          } as IConditionalRollupFieldOptions,
        } as IFieldRo);

        const fieldAfterDisable = await getField(host.id, rollupField.id);
        // eslint-disable-next-line no-console
        console.log('[test] field after disable', fieldAfterDisable.options);

        const unsortedField = await getField(host.id, rollupField.id);
        const unsortedOptions = unsortedField.options as IConditionalRollupFieldOptions;
        expect(unsortedOptions.sort).toBeUndefined();
        expect(unsortedOptions.limit).toBeUndefined();

        const unsortedRecords = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
        const unsortedActive = unsortedRecords.records.find(
          (record) => record.id === activeRecordId
        )!;
        const unsortedTitles = [...(unsortedActive.fields[rollupField.id] as string[])].sort();
        expect(unsortedTitles).toEqual(['Alpha', 'Beta', 'Gamma']);

        closedRecord = unsortedRecords.records.find((record) => record.id === closedRecordId)!;
        expect(closedRecord.fields[rollupField.id]).toEqual(['Delta']);
      } finally {
        rollupField = await convertField(host.id, rollupField.id, {
          name: originalName,
          type: FieldType.ConditionalRollup,
          options: originalOptions,
        } as IFieldRo);
        await updateRecordByApi(foreign.id, gammaRecordId, scoreId, 40);
        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Active');
      }
    });
  });

  describe('filter scenarios', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let categorySumField: IFieldVo;
    let categoryAverageField: IFieldVo;
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

      categoryAverageField = await createField(host.id, {
        name: 'Category Average',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: amountId,
          expression: 'average({values})',
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
      expect(baseline.fields[categoryAverageField.id]).toEqual(45);

      await updateRecordByApi(host.id, hardwareRecordId, categoryFieldId, 'Software');
      const updated = await getRecord(host.id, hardwareRecordId);
      expect(updated.fields[categorySumField.id]).toEqual(120);
      expect(updated.fields[categoryAverageField.id]).toEqual(60);

      await updateRecordByApi(host.id, hardwareRecordId, categoryFieldId, 'Hardware');
      const restored = await getRecord(host.id, hardwareRecordId);
      expect(restored.fields[categorySumField.id]).toEqual(90);
      expect(restored.fields[categoryAverageField.id]).toEqual(45);
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

  describe('text filter edge cases', () => {
    let foreign: ITableFullVo;
    let host: ITableFullVo;
    let emptyLabelCountField: IFieldVo;
    let nonEmptyLabelCountField: IFieldVo;
    let labelCountAField: IFieldVo;
    let alphaScoreSumField: IFieldVo;
    let labelId: string;
    let notesId: string;
    let scoreId: string;
    let hostRecordId: string;

    beforeAll(async () => {
      foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Text_Foreign',
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
        name: 'ConditionalRollup_Text_Host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Name: 'Row 1' } }],
      });
      hostRecordId = host.records[0].id;

      emptyLabelCountField = await createField(host.id, {
        name: 'Empty Label Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'count({values})',
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
        },
      } as IFieldRo);

      nonEmptyLabelCountField = await createField(host.id, {
        name: 'Non Empty Label Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'count({values})',
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
        },
      } as IFieldRo);

      labelCountAField = await createField(host.id, {
        name: 'Label CountA',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: labelId,
          expression: 'counta({values})',
        },
      } as IFieldRo);

      alphaScoreSumField = await createField(host.id, {
        name: 'Alpha Score Sum',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: scoreId,
          expression: 'sum({values})',
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
        },
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should treat blank strings as empty when filtering text fields', async () => {
      const record = await getRecord(host.id, hostRecordId);

      expect(record.fields[emptyLabelCountField.id]).toEqual(2);
      expect(record.fields[nonEmptyLabelCountField.id]).toEqual(3);
    });

    it('should skip blank values in counta aggregations', async () => {
      const record = await getRecord(host.id, hostRecordId);

      expect(record.fields[labelCountAField.id]).toEqual(3);
    });

    it('should honor contains filters for text rollups', async () => {
      const record = await getRecord(host.id, hostRecordId);

      expect(record.fields[alphaScoreSumField.id]).toEqual(17);
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

    const dateReferenceScenarios = [
      {
        name: 'aggregates matches when due date equals host target date',
        field: () => onTargetCountField,
        expected: [1, 1, 0],
      },
      {
        name: 'sums hours occurring after the host target date',
        field: () => afterTargetSumField,
        expected: [10, 7, 0],
      },
      {
        name: 'sums hours occurring before the host target date',
        field: () => beforeTargetSumField,
        expected: [0, 5, 15],
      },
      {
        name: 'counts records on or after the host target date',
        field: () => onOrAfterTargetCountField,
        expected: [3, 2, 0],
      },
      {
        name: 'counts records on or before the host target date',
        field: () => onOrBeforeTargetCountField,
        expected: [1, 2, 3],
      },
    ] as const;

    it.each(dateReferenceScenarios)('$name', async ({ field, expected }) => {
      const records = await getRecords(host.id, { fieldKeyType: FieldKeyType.Id });
      const targetTen = records.records.find((record) => record.id === targetTenRecordId)!;
      const targetEleven = records.records.find((record) => record.id === targetElevenRecordId)!;
      const targetThirteen = records.records.find(
        (record) => record.id === targetThirteenRecordId
      )!;

      const aggregateField = field();
      expect([
        targetTen.fields[aggregateField.id],
        targetEleven.fields[aggregateField.id],
        targetThirteen.fields[aggregateField.id],
      ]).toEqual(expected);
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

    it('should preserve computed metadata when renaming conditional rollups via convertField', async () => {
      const beforeRename = await getField(host.id, lookupField.id);
      const originalName = beforeRename.name;
      const fieldId = lookupField.id;
      const baseline = (await getRecord(host.id, hostRecordId)).fields[fieldId];

      try {
        lookupField = await convertField(host.id, fieldId, {
          name: `${originalName} Renamed`,
          type: FieldType.ConditionalRollup,
          options: beforeRename.options as IConditionalRollupFieldOptions,
        } as IFieldRo);

        expect(lookupField.name).toBe(`${originalName} Renamed`);
        expect(lookupField.dbFieldType).toBe(beforeRename.dbFieldType);
        expect(lookupField.isComputed).toBe(true);
        expect(lookupField.isMultipleCellValue).toBe(beforeRename.isMultipleCellValue);
        expect(lookupField.options).toEqual(beforeRename.options);

        const recordAfter = await getRecord(host.id, hostRecordId);
        expect(recordAfter.fields[fieldId]).toEqual(baseline);
      } finally {
        lookupField = await convertField(host.id, fieldId, {
          name: originalName,
          type: FieldType.ConditionalRollup,
          options: beforeRename.options as IConditionalRollupFieldOptions,
        } as IFieldRo);
      }
    });

    it('should retain computed metadata when renaming and updating conditional rollup formatting', async () => {
      const beforeUpdate = await getField(host.id, lookupField.id);
      const fieldId = lookupField.id;
      const originalName = beforeUpdate.name;
      const baseline = (await getRecord(host.id, hostRecordId)).fields[fieldId];
      const originalOptions = beforeUpdate.options as IConditionalRollupFieldOptions;
      const updatedOptions: IConditionalRollupFieldOptions = {
        ...originalOptions,
        formatting: {
          type: NumberFormattingType.Currency,
          symbol: '$',
          precision: 0,
        },
      };

      try {
        lookupField = await convertField(host.id, fieldId, {
          name: `${originalName} Renamed`,
          type: FieldType.ConditionalRollup,
          options: updatedOptions,
        } as IFieldRo);

        expect(lookupField.name).toBe(`${originalName} Renamed`);
        expect(lookupField.dbFieldType).toBe(beforeUpdate.dbFieldType);
        expect(lookupField.isComputed).toBe(true);
        expect(lookupField.isMultipleCellValue).toBe(beforeUpdate.isMultipleCellValue);
        expect((lookupField.options as IConditionalRollupFieldOptions)?.formatting).toEqual(
          updatedOptions.formatting
        );

        const recordAfter = await getRecord(host.id, hostRecordId);
        expect(recordAfter.fields[fieldId]).toEqual(baseline);
      } finally {
        lookupField = await convertField(host.id, fieldId, {
          name: originalName,
          type: FieldType.ConditionalRollup,
          options: originalOptions,
        } as IFieldRo);
      }
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

  describe('self-referencing conditional rollup propagation', () => {
    let table: ITableFullVo;
    let amountFieldId: string;
    let rollupField: IFieldVo;

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'ConditionalRollup_Self_Propagation',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Label: 'Alpha', Amount: 5 } },
          { fields: { Label: 'Beta', Amount: 3 } },
        ],
      });
      amountFieldId = table.fields.find((field) => field.name === 'Amount')!.id;

      rollupField = await createField(table.id, {
        name: 'Global Sum',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: table.id,
          lookupFieldId: amountFieldId,
          expression: 'sum({values})',
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('converts without repeating ALL_RECORDS expansion', async () => {
      const updated = await convertField(table.id, rollupField.id, {
        name: rollupField.name,
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: table.id,
          lookupFieldId: amountFieldId,
          expression: 'max({values})',
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);

      expect((updated.options as IConditionalRollupFieldOptions).expression).toBe('max({values})');

      const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const values = records.records.map((record) => record.fields[rollupField.id]);
      expect(values).toEqual([5, 5]);
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
    let sumConditionalRollupField: IFieldVo;
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
      foreign = await createTable(baseId, {
        name: 'RefLookup_Formula_Foreign',
        fields: [
          { name: 'Category', type: FieldType.SingleLineText, options: {} } as IFieldRo,
          baseField,
          taxField,
        ],
        records: [
          { fields: { Category: 'Hardware', Base: 100, Tax: 10 } },
          { fields: { Category: 'Software', Base: 50, Tax: 5 } },
        ],
      });
      categoryFieldId = foreign.fields.find((f) => f.name === 'Category')!.id;

      const totalFormulaField = await createField(foreign.id, {
        id: totalFormulaFieldId,
        name: 'Total',
        type: FieldType.Formula,
        options: {
          expression: `{${baseFieldId}} + {${taxFieldId}}`,
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
      } as IFieldRo);
      totalFormulaFieldId = totalFormulaField.id;
      expect(totalFormulaField.cellValueType).toBe(CellValueType.Number);

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

      sumConditionalRollupField = await createField(host.id, {
        name: 'Total Formula Sum Value',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: totalFormulaFieldId,
          expression: 'sum({values})',
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

      expect(hardwareRecord.fields[conditionalRollupField.id]).toEqual('110.00');
      expect(softwareRecord.fields[conditionalRollupField.id]).toEqual('55.00');
      expect(hardwareRecord.fields[sumConditionalRollupField.id]).toEqual(110);
      expect(softwareRecord.fields[sumConditionalRollupField.id]).toEqual(55);

      await updateRecordByApi(foreign.id, foreign.records[0].id, baseFieldId, 120);

      const updatedHardware = await getRecord(host.id, hardwareHostRecordId);
      expect(updatedHardware.fields[conditionalRollupField.id]).toEqual('130.00');
      expect(updatedHardware.fields[sumConditionalRollupField.id]).toEqual(130);

      const updatedSoftware = await getRecord(host.id, softwareHostRecordId);
      expect(updatedSoftware.fields[conditionalRollupField.id]).toEqual('55.00');
      expect(updatedSoftware.fields[sumConditionalRollupField.id]).toEqual(55);
    });
  });

  describe('sort dependency edge cases', () => {
    it('recomputes when the sort field is converted through the API', async () => {
      let foreign: ITableFullVo | undefined;
      let host: ITableFullVo | undefined;

      try {
        foreign = await createTable(baseId, {
          name: 'ConditionalRollup_SortConvert_Foreign',
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
          name: 'ConditionalRollup_SortConvert_Host',
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

        const rollupField = await createField(host.id, {
          name: 'Converted Sort Rollup',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            expression: 'array_compact({values})',
            filter: statusMatchFilter,
            sort: { fieldId: effectiveScoreId, order: SortFunc.Desc },
            limit: 1,
          } as IConditionalRollupFieldOptions,
        } as IFieldRo);

        const baseline = await getRecord(host.id, activeRecordId);
        expect(baseline.fields[rollupField.id]).toEqual(['Beta']);

        await convertField(foreign.id, effectiveScoreId, {
          name: 'EffectiveScore',
          type: FieldType.Formula,
          options: {
            expression: `{${rawScoreId}} + {${bonusId}}`,
          },
        } as IFieldRo);

        const refreshed = await getRecord(host.id, activeRecordId);
        expect(refreshed.fields[rollupField.id]).toEqual(['Alpha']);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        if (foreign) {
          await permanentDeleteTable(baseId, foreign.id);
        }
      }
    });

    it('drops ordering when converting an array rollup to a sum aggregation', async () => {
      let foreign: ITableFullVo | undefined;
      let host: ITableFullVo | undefined;

      try {
        foreign = await createTable(baseId, {
          name: 'ConditionalRollup_SumConvert_Foreign',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Score', type: FieldType.Number } as IFieldRo,
          ],
          records: [
            { fields: { Title: 'Alpha', Status: 'Active', Score: 70 } },
            { fields: { Title: 'Beta', Status: 'Active', Score: 90 } },
            { fields: { Title: 'Gamma', Status: 'Active', Score: 40 } },
            { fields: { Title: 'Delta', Status: 'Closed', Score: 15 } },
          ],
        });

        const statusId = foreign.fields.find((field) => field.name === 'Status')!.id;
        const scoreId = foreign.fields.find((field) => field.name === 'Score')!.id;

        host = await createTable(baseId, {
          name: 'ConditionalRollup_SumConvert_Host',
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

        let rollupField = await createField(host.id, {
          name: 'Top Scores Array',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: scoreId,
            expression: 'array_compact({values})',
            filter: statusMatchFilter,
            sort: { fieldId: scoreId, order: SortFunc.Desc },
            limit: 2,
          } as IConditionalRollupFieldOptions,
        } as IFieldRo);

        const baseline = await getRecord(host.id, activeRecordId);
        expect(baseline.fields[rollupField.id]).toEqual([90, 70]);

        rollupField = await convertField(host.id, rollupField.id, {
          name: 'Total Score',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: scoreId,
            expression: 'sum({values})',
            filter: statusMatchFilter,
            // Simulate stale sort/limit payload coming from the client
            sort: { fieldId: scoreId, order: SortFunc.Desc },
            limit: 2,
          } as IConditionalRollupFieldOptions,
        } as IFieldRo);

        const converted = await getField(host.id, rollupField.id);
        const convertedOptions = converted.options as IConditionalRollupFieldOptions;
        expect(convertedOptions.sort).toBeUndefined();
        expect(convertedOptions.limit).toBeUndefined();
        expect(converted.cellValueType).toBe(CellValueType.Number);

        const updated = await getRecord(host.id, activeRecordId);
        expect(updated.fields[rollupField.id]).toEqual(200);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        if (foreign) {
          await permanentDeleteTable(baseId, foreign.id);
        }
      }
    });

    it('ignores sorting after the sort field is deleted', async () => {
      let foreign: ITableFullVo | undefined;
      let host: ITableFullVo | undefined;

      try {
        foreign = await createTable(baseId, {
          name: 'ConditionalRollup_DeleteSort_Foreign',
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
          name: 'ConditionalRollup_DeleteSort_Host',
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

        const rollupField = await createField(host.id, {
          name: 'Limit Without Sort Rollup',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: titleId,
            expression: 'array_compact({values})',
            filter: statusMatchFilter,
            sort: { fieldId: effectiveScoreId, order: SortFunc.Desc },
            limit: 1,
          } as IConditionalRollupFieldOptions,
        } as IFieldRo);

        const baseline = await getRecord(host.id, activeRecordId);
        expect(baseline.fields[rollupField.id]).toEqual(['Beta']);

        await deleteField(foreign.id, effectiveScoreId);

        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Closed');
        await updateRecordByApi(host.id, activeRecordId, statusFilterId, 'Active');

        let refreshedList: string[] | undefined;
        for (let attempt = 0; attempt < 5; attempt++) {
          const record = await getRecord(host.id, activeRecordId);
          const candidate = record.fields[rollupField.id] as string[] | undefined;
          if (Array.isArray(candidate)) {
            refreshedList = candidate;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(Array.isArray(refreshedList)).toBe(true);
        expect(refreshedList!.length).toBe(1);
        expect(refreshedList![0]).not.toBe('Delta');
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

  describe('circular dependency detection', () => {
    it('rejects converting conditional rollups into a cycle', async () => {
      let alpha: ITableFullVo | undefined;
      let beta: ITableFullVo | undefined;
      let betaRollup: IFieldVo | undefined;
      let alphaRollup: IFieldVo | undefined;

      try {
        alpha = await createTable(baseId, {
          name: 'ConditionalRollup_Cycle_Alpha',
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
          name: 'ConditionalRollup_Cycle_Beta',
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

        const matchAlphaToBeta: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: alphaKeyId,
              operator: 'is',
              value: { type: 'field', fieldId: betaKeyId },
            },
          ],
        };

        const matchBetaToAlpha: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: betaKeyId,
              operator: 'is',
              value: { type: 'field', fieldId: alphaKeyId },
            },
          ],
        };

        betaRollup = await createField(beta.id, {
          name: 'Alpha Value Count',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: alpha.id,
            lookupFieldId: alphaValueId,
            expression: 'count({values})',
            filter: matchAlphaToBeta,
          },
        } as IFieldRo);

        alphaRollup = await createField(alpha.id, {
          name: 'Beta Rollup Count',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: beta.id,
            lookupFieldId: betaRollup.id,
            expression: 'count({values})',
            filter: matchBetaToAlpha,
          },
        } as IFieldRo);

        await convertField(
          beta.id,
          betaRollup.id,
          {
            name: 'Alpha Value Count',
            type: FieldType.ConditionalRollup,
            options: {
              foreignTableId: alpha.id,
              lookupFieldId: alphaRollup.id,
              expression: 'count({values})',
              filter: matchAlphaToBeta,
            },
          } as IFieldRo,
          400
        );

        const rollupAfterFailure = await getField(beta.id, betaRollup.id);
        const rollupOptions = rollupAfterFailure.options as IConditionalRollupFieldOptions;
        expect(rollupOptions.lookupFieldId).toBe(alphaValueId);
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
    let rollupField: IFieldVo;
    let hoursId: string;
    let foreignOwnerId: string;
    let hostOwnerId: string;
    let assignedRecordId: string;
    let emptyRecordId: string;

    beforeAll(async () => {
      const { userId, userName, email } = globalThis.testConfig;
      const userCell = { id: userId, title: userName, email };

      foreign = await createTable(baseId, {
        name: 'ConditionalRollup_User_Foreign',
        fields: [
          { name: 'Task', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Owner', type: FieldType.User } as IFieldRo,
          { name: 'Hours', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Task: 'Task Alpha', Owner: userCell, Hours: 3 } },
          { fields: { Task: 'Task Beta', Owner: userCell, Hours: 2 } },
          { fields: { Task: 'Task Gamma', Hours: 4 } },
        ],
      });

      hoursId = foreign.fields.find((field) => field.name === 'Hours')!.id;
      foreignOwnerId = foreign.fields.find((field) => field.name === 'Owner')!.id;

      host = await createTable(baseId, {
        name: 'ConditionalRollup_User_Host',
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

      rollupField = await createField(host.id, {
        name: 'Assigned Hours',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: foreign.id,
          lookupFieldId: hoursId,
          expression: 'sum({values})',
          filter: ownerMatchFilter,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, host.id);
      await permanentDeleteTable(baseId, foreign.id);
    });

    it('should create conditional rollup filtered by matching users', async () => {
      expect(rollupField.id).toBeDefined();

      const assignedRecord = await getRecord(host.id, assignedRecordId);
      expect((assignedRecord.fields[rollupField.id] as number | null | undefined) ?? 0).toBe(5);

      const emptyRecord = await getRecord(host.id, emptyRecordId);
      expect((emptyRecord.fields[rollupField.id] as number | null | undefined) ?? 0).toBe(0);
    });
  });

  describe('field reference compatibility validation', () => {
    it('marks rollup as errored when host reference field type changes', async () => {
      const foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Compat_Foreign',
        fields: [
          { name: 'Player', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Player: 'Alpha', Score: 10 } },
          { fields: { Player: 'Beta', Score: 7 } },
        ],
      });
      const scoreFieldId = foreign.fields.find((field) => field.name === 'Score')!.id;

      const host = await createTable(baseId, {
        name: 'ConditionalRollup_Compat_Host',
        fields: [{ name: 'Threshold', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { Threshold: 8 } }],
      });
      const thresholdFieldId = host.fields.find((field) => field.name === 'Threshold')!.id;

      try {
        const filter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: scoreFieldId,
              operator: isGreater.value,
              value: { type: 'field', fieldId: thresholdFieldId },
            },
          ],
        };

        const rollupField = await createField(host.id, {
          name: 'Scores Above Threshold',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: scoreFieldId,
            expression: 'sum({values})',
            filter,
          } satisfies IConditionalRollupFieldOptions,
        } as IFieldRo);

        const initial = await getField(host.id, rollupField.id);
        expect(initial.hasError).toBeFalsy();

        await convertField(host.id, thresholdFieldId, {
          name: 'Threshold',
          type: FieldType.SingleLineText,
          options: {},
        } as IFieldRo);

        const afterHostConvert = await getField(host.id, rollupField.id);
        expect(afterHostConvert.hasError).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, host.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('marks rollup as errored when foreign filter field type changes', async () => {
      const foreign = await createTable(baseId, {
        name: 'ConditionalRollup_Compat_ForeignField',
        fields: [
          { name: 'Player', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Player: 'Alpha', Score: 5 } },
          { fields: { Player: 'Beta', Score: 15 } },
        ],
      });
      const scoreFieldId = foreign.fields.find((field) => field.name === 'Score')!.id;

      const host = await createTable(baseId, {
        name: 'ConditionalRollup_Compat_HostField',
        fields: [{ name: 'Threshold', type: FieldType.Number } as IFieldRo],
        records: [{ fields: { Threshold: 10 } }],
      });
      const thresholdFieldId = host.fields.find((field) => field.name === 'Threshold')!.id;

      try {
        const filter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: scoreFieldId,
              operator: isGreater.value,
              value: { type: 'field', fieldId: thresholdFieldId },
            },
          ],
        };

        const rollupField = await createField(host.id, {
          name: 'Filtered Scores',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: scoreFieldId,
            expression: 'count({values})',
            filter,
          } satisfies IConditionalRollupFieldOptions,
        } as IFieldRo);

        const initial = await getField(host.id, rollupField.id);
        expect(initial.hasError).toBeFalsy();

        await convertField(foreign.id, scoreFieldId, {
          name: 'Score',
          type: FieldType.SingleLineText,
          options: {},
        } as IFieldRo);

        const afterForeignConvert = await getField(host.id, rollupField.id);
        expect(afterForeignConvert.hasError).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, host.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });

  describe('self-referencing field reference filters', () => {
    let table: ITableFullVo;
    let linkField: IFieldVo;
    let statusFieldId: string;
    let scoreFieldId: string;
    let rollupField: IFieldVo;
    let recordIds: string[];

    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'ConditionalRollup_SelfReference',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Name: 'Alpha', Status: 'todo', Score: 5 } },
          { fields: { Name: 'Beta', Status: 'todo', Score: 5 } },
          { fields: { Name: 'Gamma', Status: 'todo', Score: 8 } },
          { fields: { Name: 'Delta', Status: 'done', Score: 5 } },
        ],
      });
      statusFieldId = table.fields.find((field) => field.name === 'Status')!.id;
      scoreFieldId = table.fields.find((field) => field.name === 'Score')!.id;
      recordIds = table.records.map((record) => record.id);

      linkField = await createField(table.id, {
        name: 'Related',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table.id,
        },
      } as IFieldRo);

      const linkTargets = recordIds.map((id) => ({ id }));
      for (const recordId of recordIds) {
        await updateRecordByApi(table.id, recordId, linkField.id, linkTargets);
      }

      const filter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: statusFieldId, tableId: table.id },
          },
          {
            fieldId: scoreFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: scoreFieldId, tableId: table.id },
          },
        ],
      };

      rollupField = await createField(table.id, {
        name: 'Self Matching Count',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: table.id,
          lookupFieldId: scoreFieldId,
          expression: 'countall({values})',
          filter,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('aggregates without recursion issues when comparing identical fields', async () => {
      const records = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const byId = new Map(records.records.map((record) => [record.id, record]));

      expect(byId.get(recordIds[0])?.fields[rollupField.id]).toEqual(2);
      expect(byId.get(recordIds[1])?.fields[rollupField.id]).toEqual(2);
      expect(byId.get(recordIds[2])?.fields[rollupField.id]).toEqual(1);
      expect(byId.get(recordIds[3])?.fields[rollupField.id]).toEqual(1);

      await updateRecordByApi(table.id, recordIds[1], scoreFieldId, 6);

      const updated = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const updatedById = new Map(updated.records.map((record) => [record.id, record]));

      expect(updatedById.get(recordIds[0])?.fields[rollupField.id]).toEqual(1);
      expect(updatedById.get(recordIds[1])?.fields[rollupField.id]).toEqual(1);
      expect(updatedById.get(recordIds[2])?.fields[rollupField.id]).toEqual(1);
      expect(updatedById.get(recordIds[3])?.fields[rollupField.id]).toEqual(1);
    });
  });

  describe('numeric array field reference rollups', () => {
    let games: ITableFullVo;
    let summary: ITableFullVo;
    let gamesLinkFieldId: string;
    let scoreFieldId: string;
    let thresholdFieldId: string;
    let ceilingFieldId: string;
    let targetFieldId: string;
    let exactFieldId: string;
    let excludeFieldId: string;
    let aliceSummaryId: string;
    let bobSummaryId: string;
    let sumAboveThresholdField: IFieldVo;
    let sumWithinCeilingField: IFieldVo;
    let sumEqualTargetField: IFieldVo;
    let sumWithoutExactField: IFieldVo;
    let sumWithoutExcludedField: IFieldVo;

    beforeAll(async () => {
      games = await createTable(baseId, {
        name: 'ConditionalRollup_NumberArray_Games',
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
      scoreFieldId = games.fields.find((f) => f.name === 'Score')!.id;

      const gamePlayerFieldId = games.fields.find((f) => f.name === 'Player')!.id;

      summary = await createTable(baseId, {
        name: 'ConditionalRollup_NumberArray_Summary',
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
      thresholdFieldId = summary.fields.find((f) => f.name === 'Threshold')!.id;
      ceilingFieldId = summary.fields.find((f) => f.name === 'Ceiling')!.id;
      targetFieldId = summary.fields.find((f) => f.name === 'Target')!.id;
      exactFieldId = summary.fields.find((f) => f.name === 'Exact')!.id;
      excludeFieldId = summary.fields.find((f) => f.name === 'Exclude')!.id;
      aliceSummaryId = summary.records[0].id;
      bobSummaryId = summary.records[1].id;

      const thresholdFilter: IFilter = {
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
      sumAboveThresholdField = await createField(summary.id, {
        name: 'Sum Above Threshold',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          expression: 'sum({values})',
          filter: thresholdFilter,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);

      const ceilingFilter: IFilter = {
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
      sumWithinCeilingField = await createField(summary.id, {
        name: 'Sum Within Ceiling',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          expression: 'sum({values})',
          filter: ceilingFilter,
        } as IConditionalRollupFieldOptions,
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
      sumEqualTargetField = await createField(summary.id, {
        name: 'Sum Equal Target',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          expression: 'sum({values})',
          filter: equalTargetFilter,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);

      const excludeExactFilter: IFilter = {
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
      sumWithoutExactField = await createField(summary.id, {
        name: 'Sum Without Exact',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          expression: 'sum({values})',
          filter: excludeExactFilter,
        } as IConditionalRollupFieldOptions,
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
      sumWithoutExcludedField = await createField(summary.id, {
        name: 'Sum Without Excluded',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: games.id,
          lookupFieldId: scoreFieldId,
          expression: 'sum({values})',
          filter: withoutExcludedFilter,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, summary.id);
      await permanentDeleteTable(baseId, games.id);
    });

    it('aggregates numeric arrays with field references', async () => {
      const records = await getRecords(summary.id, { fieldKeyType: FieldKeyType.Id });
      const aliceSummary = records.records.find((record) => record.id === aliceSummaryId)!;
      const bobSummary = records.records.find((record) => record.id === bobSummaryId)!;

      expect(aliceSummary.fields[sumAboveThresholdField.id]).toEqual(12);
      expect(
        (bobSummary.fields[sumAboveThresholdField.id] as number | null | undefined) ?? 0
      ).toEqual(0);

      expect(aliceSummary.fields[sumWithinCeilingField.id]).toEqual(22);
      expect(bobSummary.fields[sumWithinCeilingField.id]).toEqual(7);

      expect(aliceSummary.fields[sumEqualTargetField.id]).toEqual(12);
      expect((bobSummary.fields[sumEqualTargetField.id] as number | null | undefined) ?? 0).toEqual(
        0
      );

      expect(aliceSummary.fields[sumWithoutExactField.id]).toEqual(10);
      expect(
        (bobSummary.fields[sumWithoutExactField.id] as number | null | undefined) ?? 0
      ).toEqual(0);

      expect(aliceSummary.fields[sumWithoutExcludedField.id]).toEqual(12);
      expect(bobSummary.fields[sumWithoutExcludedField.id]).toEqual(7);
    });
  });
});
