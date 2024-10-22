/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, NumberFormattingType, Relationship } from '@teable/core';
import type { IGetRecordsRo, ITableFullVo } from '@teable/openapi';
import { getRowCount as apiGetRowCount } from '@teable/openapi';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getFields,
  getRecords,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI link Select (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('get records filter by link field Id', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        name: 'table1',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    describe.each([
      {
        relationship: Relationship.OneMany,
        reversRelationship: Relationship.ManyOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 1 }, right: { c: 2, s: 1 } },
        ],
        direction: 'two way',
        isOneWay: undefined,
      },
      {
        relationship: Relationship.OneMany,
        reversRelationship: Relationship.ManyOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 1 }, right: { c: 2, s: 1 } },
        ],
        direction: 'one Way',
        isOneWay: true,
      },
      {
        relationship: Relationship.OneOne,
        reversRelationship: Relationship.OneOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
        ],
        direction: 'two way',
        isOneWay: undefined,
      },
      {
        relationship: Relationship.OneOne,
        reversRelationship: Relationship.OneOne,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
        ],
        direction: 'one Way',
        isOneWay: true,
      },
      {
        relationship: Relationship.ManyMany,

        reversRelationship: Relationship.ManyMany,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 1 }, right: { c: 3, s: 1 } },
        ],
        direction: 'two way',
      },
      {
        relationship: Relationship.ManyMany,
        reversRelationship: Relationship.ManyMany,
        result: [
          { left: { c: 3, s: 0 }, right: { c: 3, s: 0 } },
          { left: { c: 2, s: 1 }, right: { c: 2, s: 1 } },
          { left: { c: 3, s: 1 }, right: { c: 3, s: 1 } },
        ],
        isOneWay: true,
      },
    ])(
      'fetch candidate records for $relationship, $reversRelationship, $direction field',
      ({ relationship, reversRelationship, isOneWay, result }) => {
        let linkField1: IFieldVo;
        let linkField2: IFieldVo;
        beforeEach(async () => {
          // create link field
          const Link1FieldRo: IFieldRo = {
            name: 'link field',
            type: FieldType.Link,
            options: {
              relationship,
              foreignTableId: table2.id,
              isOneWay,
            },
          };

          linkField1 = await createField(table1.id, Link1FieldRo);

          if (isOneWay) {
            // create link field back
            const Link2FieldRo: IFieldRo = {
              name: 'link field',
              type: FieldType.Link,
              options: {
                relationship: reversRelationship,
                foreignTableId: table1.id,
                isOneWay: true,
              },
            };
            linkField2 = await createField(table2.id, Link2FieldRo);
          } else {
            const table2Fields = await getFields(table2.id);
            linkField2 = table2Fields[2];
          }
        });

        it('should fetch all candidate and selected records', async () => {
          const table1Candidate: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField2.id, table2.records[0].id],
          };

          const table1Selected: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField2.id, table2.records[0].id],
          };

          const table2Candidate: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField1.id, table1.records[0].id],
          };

          const table2Selected: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField1.id, table1.records[0].id],
          };

          const table1CResult = await getRecords(table1.id, table1Candidate);
          expect(table1CResult.records.length).toBe(result[0].left.c);

          const table1CResultRow = (await apiGetRowCount(table1.id, table1Candidate)).data;
          expect(table1CResultRow.rowCount).toBe(result[0].left.c);

          const table1SResult = await getRecords(table1.id, table1Selected);
          expect(table1SResult.records.length).toBe(result[0].left.s);

          const table1SResultRow = (await apiGetRowCount(table1.id, table1Selected)).data;
          expect(table1SResultRow.rowCount).toBe(result[0].left.s);

          const table2CResult = await getRecords(table2.id, table2Candidate);
          expect(table2CResult.records.length).toBe(result[0].right.c);

          const table2CResultRow = (await apiGetRowCount(table2.id, table2Candidate)).data;
          expect(table2CResultRow.rowCount).toBe(result[0].right.c);

          const table2SResult = await getRecords(table2.id, table2Selected);
          expect(table2SResult.records.length).toBe(result[0].right.s);

          const table2SResultRow = (await apiGetRowCount(table2.id, table2Selected)).data;
          expect(table2SResultRow.rowCount).toBe(result[0].right.s);
        });

        it('should fetch candidate and selected records after link', async () => {
          const value =
            relationship === Relationship.ManyMany
              ? [{ id: table1.records[0].id }]
              : { id: table1.records[0].id };
          // table2 link field first record link to table1 first record
          await updateRecordByApi(table2.id, table2.records[0].id, linkField2.id, value);
          if (isOneWay) {
            // table1 link field first record link to table2 first record
            const value =
              relationship === Relationship.OneOne
                ? { id: table2.records[0].id }
                : [{ id: table2.records[0].id }];
            await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, value);
          }

          const table1Candidate: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField2.id, table2.records[0].id],
          };

          const table1Selected: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField2.id, table2.records[0].id],
          };

          const table2Candidate: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: [linkField1.id, table1.records[0].id],
          };

          const table2Selected: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: [linkField1.id, table1.records[0].id],
          };

          const table1CResult = await getRecords(table1.id, table1Candidate);
          expect(table1CResult.records.length).toBe(result[1].left.c);

          const table1SResult = await getRecords(table1.id, table1Selected);
          expect(table1SResult.records.length).toBe(result[1].left.s);

          const table2CResult = await getRecords(table2.id, table2Candidate);
          expect(table2CResult.records.length).toBe(result[1].right.c);

          const table2SResult = await getRecords(table2.id, table2Selected);
          expect(table2SResult.records.length).toBe(result[1].right.s);
        });

        it('should fetch candidate and selected records after link without recordId', async () => {
          const value =
            relationship === Relationship.ManyMany
              ? [{ id: table1.records[0].id }]
              : { id: table1.records[0].id };
          // table2 link field first record link to table1 first record
          await updateRecordByApi(table2.id, table2.records[0].id, linkField2.id, value);
          if (isOneWay) {
            // table1 link field first record link to table2 first record
            const value =
              relationship === Relationship.OneOne
                ? { id: table2.records[0].id }
                : [{ id: table2.records[0].id }];
            await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, value);
          }

          const table1Candidate: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: linkField2.id,
          };

          const table1Selected: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: linkField2.id,
          };

          const table2Candidate: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellCandidate: linkField1.id,
          };

          const table2Selected: IGetRecordsRo = {
            fieldKeyType: FieldKeyType.Id,
            filterLinkCellSelected: linkField1.id,
          };

          const table1CResult = await getRecords(table1.id, table1Candidate);
          expect(table1CResult.records.length).toBe(result[2].left.c);

          const table1SResult = await getRecords(table1.id, table1Selected);
          expect(table1SResult.records.length).toBe(result[2].left.s);

          const table2CResult = await getRecords(table2.id, table2Candidate);
          expect(table2CResult.records.length).toBe(result[2].right.c);

          const table2SResult = await getRecords(table2.id, table2Selected);
          expect(table2SResult.records.length).toBe(result[2].right.s);
        });
      }
    );

    describe('fetch selected records with sort', () => {
      let linkField2: IFieldVo;
      beforeEach(async () => {
        // create link field
        const Link1FieldRo: IFieldRo = {
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: table2.id,
          },
        };

        await createField(table1.id, Link1FieldRo);

        const table2Fields = await getFields(table2.id);
        linkField2 = table2Fields[2];
      });

      it('should sort selected records', async () => {
        // table2 link field first record link to table1 first record
        const updateValue1 = [
          { id: table1.records[2].id },
          { id: table1.records[0].id },
          { id: table1.records[1].id },
        ];
        await updateRecordByApi(table2.id, table2.records[0].id, linkField2.id, updateValue1);
        const table1Selected: IGetRecordsRo = {
          fieldKeyType: FieldKeyType.Id,
          filterLinkCellSelected: [linkField2.id, table2.records[0].id],
        };
        const result = await getRecords(table1.id, table1Selected);
        expect(result.records).toMatchObject(updateValue1);

        const updateValue2 = [
          { id: table1.records[2].id },
          { id: table1.records[1].id },
          { id: table1.records[0].id },
        ];
        await updateRecordByApi(table2.id, table2.records[0].id, linkField2.id, updateValue2);
        const result2 = await getRecords(table1.id, table1Selected);
        expect(result2.records).toMatchObject(updateValue2);
      });
    });

    describe('fetch candidate records', () => {
      let linkField2: IFieldVo;
      beforeEach(async () => {
        // create link field
        const Link1FieldRo: IFieldRo = {
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: table2.id,
          },
        };

        await createField(table1.id, Link1FieldRo);

        const table2Fields = await getFields(table2.id);
        // oneMany
        linkField2 = table2Fields[2];
      });

      it('should filter candidate records that cannot be select', async () => {
        // table2 link field first record link to table1 first record
        const updateValue1 = [
          { id: table1.records[2].id },
          { id: table1.records[0].id },
          { id: table1.records[1].id },
        ];
        await updateRecordByApi(table2.id, table2.records[0].id, linkField2.id, updateValue1);
        const table1Record0Selected: IGetRecordsRo = {
          fieldKeyType: FieldKeyType.Id,
          filterLinkCellCandidate: [linkField2.id, table2.records[0].id],
        };
        const result0 = await getRecords(table1.id, table1Record0Selected);
        expect(result0.records.length).toEqual(0);

        const table1Record1Selected: IGetRecordsRo = {
          fieldKeyType: FieldKeyType.Id,
          filterLinkCellCandidate: [linkField2.id, table2.records[1].id],
        };
        const result1 = await getRecords(table1.id, table1Record1Selected);
        expect(result1.records.length).toEqual(0);
      });
    });

    describe('fetch selected records', () => {
      let linkField2: IFieldVo;
      beforeEach(async () => {
        const Link1FieldRo: IFieldRo = {
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: table2.id,
          },
        };

        await createField(table1.id, Link1FieldRo);

        const table2Fields = await getFields(table2.id);
        linkField2 = table2Fields[2];
      });

      it('should filter records by selected recordIds', async () => {
        const recordRo: IGetRecordsRo = {
          fieldKeyType: FieldKeyType.Id,
          selectedRecordIds: [table1.records[0].id, table1.records[1].id],
        };

        const result = await getRecords(table1.id, recordRo);
        expect(result.records.length).toEqual(2);

        const rowCountResult = (await apiGetRowCount(table1.id, recordRo)).data;
        expect(rowCountResult.rowCount).toBe(2);
      });

      it('should filter candidate records by selected recordIds', async () => {
        const updateValue1 = [{ id: table1.records[2].id }];

        await updateRecordByApi(table2.id, table2.records[0].id, linkField2.id, updateValue1);

        const table1Record0Selected: IGetRecordsRo = {
          fieldKeyType: FieldKeyType.Id,
          filterLinkCellCandidate: [linkField2.id, table2.records[0].id],
          selectedRecordIds: [table1.records[1].id],
        };

        const result = await getRecords(table1.id, table1Record0Selected);
        expect(result.records.length).toEqual(1);

        const rowCountResult = (await apiGetRowCount(table1.id, table1Record0Selected)).data;
        expect(rowCountResult.rowCount).toBe(1);
      });
    });
  });
});
