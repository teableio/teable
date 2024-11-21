/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  ILinkFieldOptions,
  ILookupOptionsRo,
  IRecord,
  IRollupFieldOptions,
  ISelectFieldOptions,
} from '@teable/core';
import {
  Relationship,
  TimeFormatting,
  DbFieldType,
  Colors,
  CellValueType,
  FieldType,
  NumberFormattingType,
  RatingIcon,
  defaultDatetimeFormatting,
  FieldKeyType,
  SingleLineTextDisplayType,
  DateFormattingPreset,
  generateFieldId,
  DriverClient,
  CellFormat,
} from '@teable/core';
import { type ITableFullVo } from '@teable/openapi';
import {
  getRecords,
  createField,
  createRecords,
  getField,
  getRecord,
  initApp,
  convertField,
  deleteRecord,
  updateRecordByApi,
  createTable,
  permanentDeleteTable,
  deleteRecords,
} from './utils/init-app';

describe('OpenAPI Freely perform column transformations (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo;
  let table2: ITableFullVo;
  let table3: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  const bfAf = () => {
    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
      table3 = await createTable(baseId, { name: 'table3' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
      await permanentDeleteTable(baseId, table3.id);
    });
  };

  async function expectUpdate(
    table: ITableFullVo,
    sourceFieldRo: IFieldRo,
    newFieldRo: IFieldRo,
    values: unknown[] = [],
    createdCallback?: (newField: IFieldVo) => Promise<void>,
    appendBlankRow?: number
  ) {
    const sourceField = await createField(table.id, sourceFieldRo);
    await createdCallback?.(sourceField);
    if (appendBlankRow) {
      const records = [];
      for (let i = 0; i < appendBlankRow; i++) {
        records.push({ fields: {} });
      }
      const createData = await createRecords(table.id, { records });
      table.records.push(...createData.records);
    }

    for (const i in values) {
      const value = values[i];
      value != null &&
        (await updateRecordByApi(table.id, table.records[i].id, sourceField.id, value));
    }
    await convertField(table.id, sourceField.id, newFieldRo);
    const newField = await getField(table.id, sourceField.id);
    const records: IRecord[] = [];
    for (let i = 0; i < values.length; i++) {
      const record = await getRecord(table.id, table.records[i].id);
      records.push(record);
    }

    const result = records.map((record) => record.fields[newField.id]);
    return {
      newField,
      sourceField,
      values: result,
      records,
    };
  }

  describe('modify general property', () => {
    bfAf();
    it('should modify field name and prevent name duplicate', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        description: 'hello',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        name: 'New Name',
        type: FieldType.SingleLineText,
      };

      const { newField } = await expectUpdate(table1, sourceFieldRo, newFieldRo);
      expect(newField.name).toEqual('New Name');
      expect(newField.description).toEqual('hello');

      await expect(
        convertField(table1.id, table1.fields[0].id, {
          name: 'New Name',
          type: FieldType.SingleLineText,
        })
      ).rejects.toThrow();
    });

    it('should modify options showAs', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        description: 'hello',
        type: FieldType.SingleLineText,
        options: {
          showAs: {
            type: SingleLineTextDisplayType.Email,
          },
        },
      };
      const newFieldRo: IFieldRo = {
        name: 'New Name',
        type: FieldType.SingleLineText,
        options: {},
      };

      const { newField } = await expectUpdate(table1, sourceFieldRo, newFieldRo);
      expect(newField.options).toEqual({});
    });

    it('should modify options showAs in formula', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        description: 'hello',
        type: FieldType.Formula,
        options: {
          expression: '"text"',
          showAs: {
            type: SingleLineTextDisplayType.Email,
          },
        },
      };
      const newFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: '"text"',
        },
      };

      const { newField } = await expectUpdate(table1, sourceFieldRo, newFieldRo);
      expect(newField.options).toEqual({
        expression: '"text"',
      });
    });

    it.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
      'should modify field validation',
      async () => {
        const sourceFieldRo: IFieldRo = {
          name: 'TextField',
          type: FieldType.SingleLineText,
        };
        const uniqueFieldRo: IFieldRo = {
          ...sourceFieldRo,
          unique: true,
        };
        const notNullFieldRo: IFieldRo = {
          ...sourceFieldRo,
          unique: false,
          notNull: true,
        };

        const table2Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

        await deleteRecords(
          table1.id,
          table2Records.records.map((record) => record.id)
        );

        const sourceField = await createField(table1.id, sourceFieldRo);
        const { records } = await createRecords(table1.id, {
          records: [
            {
              fields: {
                [sourceField.id]: '100',
              },
            },
            {
              fields: {
                [sourceField.id]: '100',
              },
            },
            {
              fields: {},
            },
          ],
        });

        await convertField(table1.id, sourceField.id, uniqueFieldRo, 400);

        await deleteRecord(table1.id, records[1].id);

        await convertField(table1.id, sourceField.id, uniqueFieldRo);

        await convertField(table1.id, sourceField.id, notNullFieldRo, 400);

        await deleteRecord(table1.id, records[2].id);

        await convertField(table1.id, sourceField.id, notNullFieldRo);
      }
    );

    it('should modify attachment field name', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        description: 'hello',
        type: FieldType.Attachment,
      };
      const newFieldRo: IFieldRo = {
        name: 'New Name',
        type: FieldType.Attachment,
      };

      const { newField } = await expectUpdate(table1, sourceFieldRo, newFieldRo);
      expect(newField.name).toEqual('New Name');
    });

    it('should modify db field name', async () => {
      const dbFieldName = generateFieldId();
      const sourceFieldRo1: IFieldRo = {
        name: 'TextField',
        description: 'hello',
        dbFieldName: dbFieldName,
        type: FieldType.SingleLineText,
      };

      const field = await createField(table1.id, sourceFieldRo1);
      expect(field.dbFieldName).toEqual(dbFieldName);

      await createField(table1.id, sourceFieldRo1, 400);

      const sourceFieldRo2: IFieldRo = {
        name: 'TextField 2',
        description: 'hello',
        dbFieldName: dbFieldName + '2',
        type: FieldType.SingleLineText,
      };

      const newFieldRo: IFieldRo = {
        dbFieldName: generateFieldId(),
        type: FieldType.SingleLineText,
      };

      const { newField } = await expectUpdate(table1, sourceFieldRo2, newFieldRo);
      expect(newField.dbFieldName).toEqual(newFieldRo.dbFieldName);
      expect(newField.name).toEqual('TextField 2');
      expect(newField.description).toEqual('hello');
    });

    it('should modify formula field name', async () => {
      const formulaFieldRo: IFieldRo = {
        name: 'formulaField',
        type: FieldType.Formula,
        options: {
          expression: '1+1',
        },
      };

      const formulaFieldRo2: IFieldRo = {
        name: 'new FormulaField',
        type: FieldType.Formula,
        options: {
          expression: '1+1',
        },
      };

      const { newField } = await expectUpdate(table1, formulaFieldRo, formulaFieldRo2);
      expect(newField.name).toEqual('new FormulaField');
    });

    it.each([{ relationship: Relationship.OneOne }])(
      'should modify $relationship link field name',
      async ({ relationship }) => {
        const linkFieldRo: IFieldRo = {
          name: 'linkField',
          type: FieldType.Link,
          options: {
            relationship,
            foreignTableId: table2.id,
          },
        };

        const linkFieldRo2: IFieldRo = {
          name: 'other name',
          type: FieldType.Link,
          options: {
            relationship,
            foreignTableId: table2.id,
          },
        };

        const linkField = await createField(table1.id, linkFieldRo);
        await updateRecordByApi(
          table1.id,
          table1.records[0].id,
          linkField.id,
          linkField.isMultipleCellValue
            ? [
                {
                  id: table2.records[0].id,
                },
              ]
            : {
                id: table2.records[0].id,
              }
        );
        const symField = await getField(
          table2.id,
          (linkField.options as ILinkFieldOptions).symmetricFieldId as string
        );
        const newField = await convertField(table1.id, linkField.id, linkFieldRo2);

        expect(newField.name).toEqual('other name');

        const { name: _, ...newFieldOthers } = newField;
        const { name: _0, ...oldFieldOthers } = linkField;

        expect(newFieldOthers).toEqual(oldFieldOthers);

        const table2Records = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });
        const newSymField = await getField(
          table2.id,
          (linkField.options as ILinkFieldOptions).symmetricFieldId as string
        );
        expect(symField).toEqual(newSymField);
        expect(table2Records.records[0].fields[newSymField.id]).toMatchObject(
          newSymField.isMultipleCellValue
            ? [{ id: table1.records[0].id }]
            : { id: table1.records[0].id }
        );
      }
    );

    it.each([{ relationship: Relationship.ManyMany }])(
      'should modify $relationship symmetric link field name',
      async ({ relationship }) => {
        const linkFieldRo: IFieldRo = {
          name: 'linkField',
          type: FieldType.Link,
          options: {
            relationship,
            foreignTableId: table2.id,
          },
        };

        const linkField = await createField(table1.id, linkFieldRo);
        const symField = await getField(
          table2.id,
          (linkField.options as ILinkFieldOptions).symmetricFieldId as string
        );
        await updateRecordByApi(
          table1.id,
          table1.records[0].id,
          linkField.id,
          linkField.isMultipleCellValue
            ? [
                {
                  id: table2.records[0].id,
                },
              ]
            : {
                id: table2.records[0].id,
              }
        );
        const newSymField = await convertField(table2.id, symField.id, {
          ...symField,
          name: 'other name',
        });

        expect(newSymField.name).toEqual('other name');

        const { name: _, ...newFieldOthers } = newSymField;
        const { name: _0, ...oldFieldOthers } = symField;

        expect(newFieldOthers).toEqual(oldFieldOthers);

        const table2Records = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });

        expect(table2Records.records[0].fields[newSymField.id]).toMatchObject(
          newSymField.isMultipleCellValue
            ? [{ id: table1.records[0].id }]
            : { id: table1.records[0].id }
        );
      }
    );

    it('should modify rollup field name', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'linkField',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      const rollupFieldRo: IFieldRo = {
        name: 'rollUpField',
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const rollupFieldRo2: IFieldRo = {
        name: 'new rollUpField',
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField } = await expectUpdate(table1, rollupFieldRo, rollupFieldRo2);
      expect(newField.name).toEqual('new rollUpField');
    });

    it('should modify lookup field name', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'linkField',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      const lookupFieldRo: IFieldRo = {
        name: 'lookupField',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const lookupFieldRo2: IFieldRo = {
        name: 'new lookupField',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField } = await expectUpdate(table1, lookupFieldRo, lookupFieldRo2);
      expect(newField.name).toEqual('new lookupField');
    });

    it('should modify field description', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'my name',
        description: 'hello',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        description: 'world',
        type: FieldType.SingleLineText,
      };

      const { newField } = await expectUpdate(table1, sourceFieldRo, newFieldRo);
      expect(newField.name).toEqual('my name');
      expect(newField.description).toEqual('world');
    });
  });

  describe('convert text field', () => {
    bfAf();

    const sourceFieldRo: IFieldRo = {
      name: 'TextField',
      type: FieldType.SingleLineText,
    };

    it('should convert text to number', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        '1',
        'x',
      ]);
      expect(newField).toMatchObject({
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        name: 'TextField',
        type: FieldType.Number,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert text to single select', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'x', color: Colors.Cyan }],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'y',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        options: {
          choices: [{ name: 'x', color: Colors.Cyan }, { name: 'y' }],
        },
        type: FieldType.SingleSelect,
      });
      expect(values[0]).toEqual('x');
      expect(values[1]).toEqual('y');
    });

    it('should convert text to multiple select', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { name: 'x', color: Colors.Blue },
            { name: 'y', color: Colors.Red },
          ],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'x, y',
        'z',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        options: {
          choices: [
            { name: 'x', color: Colors.Blue },
            { name: 'y', color: Colors.Red },
            { name: 'z' },
          ],
        },
        type: FieldType.MultipleSelect,
      });
      expect(values[0]).toEqual(['x']);
      expect(values[1]).toEqual(['x', 'y']);
      expect(values[2]).toEqual(['z']);
    });

    it('should convert text to attachment', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Attachment,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'y',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Attachment,
      });
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert text to checkbox', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Checkbox,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Boolean,
        dbFieldType: DbFieldType.Boolean,
        type: FieldType.Checkbox,
      });
      expect(values[0]).toEqual(true);
      expect(values[1]).toEqual(undefined);
    });

    it('should not convert primary field to checkbox', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Checkbox,
      };

      await expect(convertField(table1.id, table1.fields[0].id, newFieldRo)).rejects.toThrow();
    });

    it('should convert text to date', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Date,
        options: {
          formatting: {
            date: 'M/D/YYYY',
            time: TimeFormatting.None,
            timeZone: 'utc',
          },
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        '2023-08-31T08:32:32',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        type: FieldType.Date,
      });
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual('2023-08-31T08:32:32.000Z');
    });

    it('should convert text to formula', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: '1',
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Formula,
        isComputed: true,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(1);
    });

    it('should convert text to auto number', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.AutoNumber,
        options: {},
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Integer,
        type: FieldType.AutoNumber,
        isComputed: true,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(2);
    });

    it('should convert text to created time', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.CreatedTime,
        options: {
          formatting: defaultDatetimeFormatting,
        },
      };
      const { newField, values, records } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        type: FieldType.CreatedTime,
        isComputed: true,
      });
      expect(values[0]).toEqual(records[0].createdTime);
      expect(values[1]).toEqual(records[1].createdTime);
    });

    it('should convert text to last modified time', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.LastModifiedTime,
        options: {
          formatting: defaultDatetimeFormatting,
        },
      };
      const { newField, values, records } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'y',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        type: FieldType.LastModifiedTime,
        isComputed: true,
      });
      expect(values[0]).toEqual(records[0].lastModifiedTime);
      expect(values[1]).toEqual(records[1].lastModifiedTime);
    });

    it('should convert text to many-one rollup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add 2 link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[0].id,
      });

      const newFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(1);
    });

    it('should convert text to one-many rollup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'gg');
      // add 2 link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const newFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(2);
    });
  });

  describe('convert long text field', () => {
    bfAf();

    const sourceFieldRo: IFieldRo = {
      name: 'LongTextField',
      type: FieldType.LongText,
    };

    it('should convert long text to text', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        '1 2 3',
        'x\ny\nz',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        name: 'LongTextField',
        type: FieldType.SingleLineText,
      });
      expect(values[0]).toEqual('1 2 3');
      expect(values[1]).toEqual('x y z');
    });

    it('should convert long text to number', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        '1',
        'x',
      ]);
      expect(newField).toMatchObject({
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        name: 'LongTextField',
        type: FieldType.Number,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert long text to single select', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'A', color: Colors.Cyan }],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'A',
        'B',
        'Hello\nWorld',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleSelect,
      });
      expect((newField.options as { choices: { name: string }[] }).choices).toHaveLength(3);
      expect(values[0]).toEqual('A');
      expect(values[1]).toEqual('B');
      expect(values[2]).toEqual('Hello World');
    });

    it('should convert long text to multiple select', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { name: 'x', color: Colors.Blue },
            { name: 'y', color: Colors.Red },
            { name: "','", color: Colors.Gray },
            { name: ', ', color: Colors.Red },
          ],
        },
      };
      const { newField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        ['x', 'x, y', 'x\nz', `x, "','"`, `x, y, ", "`, `"','", ", "`],
        undefined,
        3
      );
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        options: {
          choices: [
            { name: 'x', color: Colors.Blue },
            { name: 'y', color: Colors.Red },
            { name: "','" },
            { name: ',' },
            { name: 'z' },
          ],
        },
        type: FieldType.MultipleSelect,
      });
      expect(values[0]).toEqual(['x']);
      expect(values[1]).toEqual(['x', 'y']);
      expect(values[2]).toEqual(['x', 'z']);
      expect(values[3]).toEqual(['x', "','"]);
      expect(values[4]).toEqual(['x', 'y', ',']);
      expect(values[5]).toEqual(["','", ',']);
    });

    it('should convert long text to attachment', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Attachment,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'x\ny',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Attachment,
      });
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert long text to checkbox', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Checkbox,
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Boolean,
        dbFieldType: DbFieldType.Boolean,
        type: FieldType.Checkbox,
      });
      expect(values[0]).toEqual(true);
      expect(values[1]).toEqual(undefined);
    });

    it('should convert long text to date', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Date,
        options: {
          formatting: {
            date: 'M/D/YYYY',
            time: TimeFormatting.None,
            timeZone: 'utc',
          },
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        '2023-08-31T08:32:32',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        type: FieldType.Date,
      });
      expect(values[0]).toEqual(undefined);
      expect(values[1]).toEqual('2023-08-31T08:32:32.000Z');
    });

    it('should convert long text to formula', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: '1',
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Formula,
        isComputed: true,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(1);
    });

    it('should convert long text to many-one rollup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add 2 link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[0].id,
      });

      const newFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(1);
    });

    it('should convert long text to one-many rollup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'gg');
      // add 2 link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const newFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(2);
    });
  });

  describe('convert select field', () => {
    bfAf();

    it('should convert select to number', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { id: 'choX', name: 'x', color: Colors.Cyan },
            { id: 'choY', name: 'y', color: Colors.Blue },
          ],
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
        type: FieldType.Number,
      });
      expect(values[0]).toEqual(undefined);
    });

    it('should change choices for single select', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { id: 'choX', name: 'x', color: Colors.Cyan },
            { id: 'choY', name: 'y', color: Colors.Blue },
          ],
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
        options: {
          choices: [{ id: 'choX', name: 'xx', color: Colors.Gray }],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x',
        'y',
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        options: {
          choices: [{ name: 'xx', color: Colors.Gray }],
        },
        type: FieldType.SingleSelect,
      });
      expect(values[0]).toEqual('xx');
      expect(values[1]).toEqual(undefined);
    });

    it('should change choices for multiple select', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { id: 'choX', name: 'x', color: Colors.Cyan },
            { id: 'choY', name: 'y', color: Colors.Blue },
          ],
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [{ id: 'choX', name: 'xx', color: Colors.Cyan }],
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        ['x'],
        ['x', 'y'],
        ['y'],
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        options: {
          choices: [{ name: 'xx', color: Colors.Cyan }],
        },
        type: FieldType.MultipleSelect,
      });
      expect(values[0]).toEqual(['xx']);
      expect(values[1]).toEqual(['xx']);
      expect(values[2]).toEqual(undefined);
    });

    it('should not accept duplicated name choices', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { id: 'choX', name: 'x', color: Colors.Cyan },
            { id: 'choY', name: 'y', color: Colors.Blue },
          ],
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { id: 'choX', name: 'y', color: Colors.Cyan },
            { id: 'choY', name: 'y', color: Colors.Blue },
          ],
        },
      };
      const sourceField = await createField(table1.id, sourceFieldRo);

      await convertField(table1.id, sourceField.id, newFieldRo, 400);
    });
  });

  describe('convert rating field', () => {
    bfAf();

    it('should correctly update and format values when transitioning from a Number field to a Rating field', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Rating,
        options: {
          icon: RatingIcon.Star,
          color: Colors.YellowBright,
          max: 5,
        },
      };
      const { newField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [1.23, 8.88]
      );
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        options: {
          icon: RatingIcon.Star,
          max: 5,
        },
        type: FieldType.Rating,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(5);
    });

    it('should correctly update and maintain values when transitioning from a Rating field to a Number field', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Rating,
        options: {
          icon: RatingIcon.Star,
          color: Colors.YellowBright,
          max: 5,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [1, 2]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
        type: FieldType.Number,
      });
      expect(values[0]).toEqual(1);
      expect(values[1]).toEqual(2);
    });

    it('should change max for rating', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Rating,
        options: {
          icon: RatingIcon.Star,
          color: Colors.YellowBright,
          max: 10,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Rating,
        options: {
          icon: RatingIcon.Star,
          color: Colors.YellowBright,
          max: 5,
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [2, 8]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        options: {
          icon: RatingIcon.Star,
          max: 5,
        },
        type: FieldType.Rating,
      });
      expect(values[0]).toEqual(2);
      expect(values[1]).toEqual(5);
    });
  });

  describe('convert formula field', () => {
    const refField1Ro: IFieldRo = {
      type: FieldType.SingleLineText,
    };

    const refField2Ro: IFieldRo = {
      type: FieldType.Number,
    };

    const sourceFieldRo: IFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: '1',
      },
    };
    let refField1: IFieldVo;
    let refField2: IFieldVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });

      refField1 = await createField(table1.id, refField1Ro);
      refField2 = await createField(table1.id, refField2Ro);

      await updateRecordByApi(table1.id, table1.records[0].id, refField1.id, 'x');
      await updateRecordByApi(table1.id, table1.records[1].id, refField1.id, 'y');

      await updateRecordByApi(table1.id, table1.records[0].id, refField2.id, 1);
      await updateRecordByApi(table1.id, table1.records[1].id, refField2.id, 2);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
    });

    it('should convert formula and modify expression', async () => {
      const newFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${refField1.id}}`,
        },
      };
      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        null,
        null,
      ]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.Formula,
        isComputed: true,
      });
      expect(values[0]).toEqual('x');
      expect(values[1]).toEqual('y');

      const newFieldRo2: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${refField2.id}}`,
        },
      };

      const newField2 = await convertField(table1.id, newField.id, newFieldRo2);

      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(newField2).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Formula,
        isComputed: true,
      });

      expect(records.records[0].fields[newField2.id]).toEqual(1);
      expect(records.records[1].fields[newField2.id]).toEqual(2);
    });

    it('should convert formula to text', async () => {
      const dateTimeField = await createField(table1.id, {
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.Hour24,
            timeZone: 'America/Los_Angeles',
          },
        },
      });

      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${dateTimeField.id}}`,
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.Hour12,
            timeZone: 'America/Los_Angeles',
          },
        },
      });

      const updated = await updateRecordByApi(
        table1.id,
        table1.records[0].id,
        dateTimeField.id,
        '2024-02-28 16:00'
      );

      expect(updated.fields[dateTimeField.id]).toEqual('2024-02-29T00:00:00.000Z');
      expect(updated.fields[formulaField.id]).toEqual('2024-02-29T00:00:00.000Z');

      const textResult = await getRecord(table1.id, table1.records[0].id, CellFormat.Text);
      expect(textResult.fields[dateTimeField.id]).toEqual('2024-02-28 16:00');
      expect(textResult.fields[formulaField.id]).toEqual('2024-02-28 04:00 PM');

      await convertField(table1.id, formulaField.id, {
        type: FieldType.SingleLineText,
      });

      const results = await getRecord(table1.id, table1.records[0].id);
      expect(results.fields[formulaField.id]).toEqual('2024-02-28 04:00 PM');
    });
  });

  describe('convert link field', () => {
    bfAf();

    it('should convert empty text to many-one link', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');

      const { newField } = await expectUpdate(table1, sourceFieldRo, newFieldRo);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });
    });

    it('should convert text to many-one link', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x, y',
        'z',
      ]);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });
      // only match 'x' in table2, because many-one link only allowed one value
      expect(values[0]).toEqual({ title: 'x', id: records[0].id });
      // clean up invalid value
      expect(values[1]).toBeUndefined();

      const table2LinkField = await getField(
        table2.id,
        (newField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect(records[0].fields[table2LinkField.id]).toMatchObject([{ id: table1.records[0].id }]);
    });

    it('should convert text to one-many link', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        'x, y',
        'zz',
      ]);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });
      expect(values[0]).toEqual([
        { title: 'x', id: records[0].id },
        { title: 'y', id: records[1].id },
      ]);
      // clean up invalid value
      expect(values[1]).toBeUndefined();
    });

    it('should convert many-one link to text', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');

      const { newField, sourceField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [{ id: table2.records[0].id }]
      );

      // make sure symmetricField have been deleted
      const sourceFieldOptions = sourceField.options as ILinkFieldOptions;
      await getField(sourceFieldOptions.foreignTableId, sourceFieldOptions.symmetricFieldId!, 404);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
      });

      expect(values[0]).toEqual('x');
    });

    it('should convert one-many link to text', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');

      const { newField, sourceField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [[{ id: table2.records[0].id }, { id: table2.records[1].id }]]
      );

      // make sure symmetricField have been deleted
      const sourceFieldOptions = sourceField.options as ILinkFieldOptions;
      await getField(sourceFieldOptions.foreignTableId, sourceFieldOptions.symmetricFieldId!, 404);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
      });

      expect(values[0]).toEqual('x, y');
    });

    it('should convert many-one to one-many link with in cell illegal', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'xx');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'yy');

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [
        { id: table2.records[0].id },
        { id: table2.records[0].id },
      ]);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });
      expect(values[0]).toEqual([{ title: 'xx', id: records[0].id }]);
      // values[1] should be remove because values[0] is selected to keep link consistency
      expect(values[1]).toEqual(undefined);
    });

    it('should convert one-many to many-one link', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'zzz');

      let lookupField: IFieldVo;
      const { newField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [
          [{ id: table2.records[0].id }, { id: table2.records[1].id }],
          [{ id: table2.records[2].id }],
        ],
        async (sourceField) => {
          const lookupFieldRo: IFieldRo = {
            type: FieldType.SingleLineText,
            isLookup: true,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          };
          lookupField = await createField(table1.id, lookupFieldRo);
          const rollupFieldRo: IFieldRo = {
            type: FieldType.Rollup,
            options: {
              expression: `count({values})`,
              formatting: {
                precision: 2,
                type: 'decimal',
              },
            } as IRollupFieldOptions,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          };
          await createField(table1.id, rollupFieldRo);
        }
      );
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      expect(lookupField!).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.SingleLineText,
        isLookup: true,
        isMultipleCellValue: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: newField.id,
        },
      });

      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });
      expect(values[0]).toEqual({ title: 'x', id: records[0].id });
      expect(values[1]).toEqual({ title: 'zzz', id: records[2].id });
    });

    it('should convert one-way link to two-way link', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'zzz');

      const sourceField = await createField(table1.id, sourceFieldRo);
      await updateRecordByApi(table1.id, table1.records[0].id, sourceField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceField.id,
        },
      });
      await createField(table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: `count({values})`,
          formatting: {
            precision: 2,
            type: 'decimal',
          },
        } as IRollupFieldOptions,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceField.id,
        },
      });

      const newField = await convertField(table1.id, sourceField.id, newFieldRo);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          isOneWay: false,
        },
      });

      const symmetricFieldId = (newField.options as ILinkFieldOptions).symmetricFieldId;
      expect(symmetricFieldId).toBeDefined();

      const symmetricField = await getField(table2.id, symmetricFieldId as string);

      expect(symmetricField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
        },
      });

      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[symmetricField.id]).toMatchObject({ id: table1.records[0].id });
      expect(records[1].fields[symmetricField.id]).toMatchObject({ id: table1.records[0].id });
    });

    it('should convert one-way link to two-way link and to other table', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table3.id,
          isOneWay: false,
        },
      };

      // set primary key in table2/table3
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      await updateRecordByApi(table3.id, table3.records[0].id, table3.fields[0].id, 'x');
      await updateRecordByApi(table3.id, table3.records[1].id, table3.fields[0].id, 'y');

      const sourceField = await createField(table1.id, sourceFieldRo);
      await updateRecordByApi(table1.id, table1.records[0].id, sourceField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceField.id,
        },
      });
      await createField(table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: `count({values})`,
          formatting: {
            precision: 2,
            type: 'decimal',
          },
        } as IRollupFieldOptions,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceField.id,
        },
      });

      const newField = await convertField(table1.id, sourceField.id, newFieldRo);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table3.id,
          lookupFieldId: table3.fields[0].id,
          isOneWay: false,
        },
      });

      const symmetricFieldId = (newField.options as ILinkFieldOptions).symmetricFieldId;
      expect(symmetricFieldId).toBeDefined();

      const symmetricField = await getField(table3.id, symmetricFieldId as string);

      expect(symmetricField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
        },
      });

      const { records } = await getRecords(table3.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[symmetricField.id]).toMatchObject({ id: table1.records[0].id });
      expect(records[1].fields[symmetricField.id]).toMatchObject({ id: table1.records[0].id });
    });

    it('should convert link from one table to another', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table3.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'z2');
      // set primary key in table3
      await updateRecordByApi(table3.id, table3.records[0].id, table3.fields[0].id, 'x');
      await updateRecordByApi(table3.id, table3.records[1].id, table3.fields[0].id, 'y');
      await updateRecordByApi(table3.id, table3.records[2].id, table3.fields[0].id, 'z3');

      const { newField, sourceField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [{ id: table2.records[0].id }, { id: table2.records[1].id }, { id: table2.records[2].id }],
        async (sourceField) => {
          await createField(table1.id, {
            type: FieldType.SingleLineText,
            isLookup: true,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          });
          await createField(table1.id, {
            type: FieldType.Rollup,
            options: {
              expression: `count({values})`,
              formatting: {
                precision: 2,
                type: 'decimal',
              },
            } as IRollupFieldOptions,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          });
        }
      );

      // make sure symmetricField have been deleted
      const sourceFieldOptions = sourceField.options as ILinkFieldOptions;
      const newFieldOptions = newField.options as ILinkFieldOptions;
      await getField(sourceFieldOptions.foreignTableId, sourceFieldOptions.symmetricFieldId!, 404);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table3.id,
          lookupFieldId: table3.fields[0].id,
        },
      });

      // make sure symmetricField have been created
      const symmetricField = await getField(table3.id, newFieldOptions.symmetricFieldId as string);
      expect(symmetricField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          symmetricFieldId: newField.id,
        },
      });

      const { records } = await getRecords(table3.id, { fieldKeyType: FieldKeyType.Id });
      expect(values[0]).toEqual({ title: 'x', id: records[0].id });
      expect(values[1]).toEqual({ title: 'y', id: records[1].id });
      expect(values[2]).toBeUndefined();
    });

    it('should convert link from one table to another with selected link record', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table3.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'B3');
      // set primary key in table3
      await updateRecordByApi(table3.id, table3.records[0].id, table3.fields[0].id, 'C1');
      await updateRecordByApi(table3.id, table3.records[1].id, table3.fields[0].id, 'C2');
      await updateRecordByApi(table3.id, table3.records[2].id, table3.fields[0].id, 'C3');

      const { sourceField } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [{ id: table2.records[0].id }],
        async (sourceField) => {
          await createField(table1.id, {
            type: FieldType.SingleLineText,
            isLookup: true,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          });
          await createField(table1.id, {
            type: FieldType.Rollup,
            options: {
              expression: `count({values})`,
              formatting: {
                precision: 2,
                type: 'decimal',
              },
            } as IRollupFieldOptions,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          });
        }
      );

      // make sure records has been updated
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[sourceField.id]).toBeUndefined();
    });

    it('should mark lookupField error when convert link from one table to another', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table3.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      // set primary key in table3
      await updateRecordByApi(table3.id, table3.records[0].id, table3.fields[0].id, 'C1');

      const sourceLinkField = await createField(table1.id, sourceFieldRo);

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceLinkField.id,
        },
      };
      const sourceLookupField = await createField(table1.id, lookupFieldRo);

      const formulaLinkFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${sourceLinkField.id}}`,
        },
      };
      const formulaLookupFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${sourceLookupField.id}}`,
        },
      };

      const sourceFormulaLinkField = await createField(table1.id, formulaLinkFieldRo);
      const sourceFormulaLookupField = await createField(table1.id, formulaLookupFieldRo);

      await updateRecordByApi(table1.id, table1.records[0].id, sourceLinkField.id, {
        id: table2.records[0].id,
      });

      // make sure records has been updated
      const { records: rs } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(rs[0].fields[sourceLinkField.id]).toEqual({ id: table2.records[0].id, title: 'B1' });
      expect(rs[0].fields[sourceLookupField.id]).toEqual('B1');
      expect(rs[0].fields[sourceFormulaLinkField.id]).toEqual('B1');
      expect(rs[0].fields[sourceFormulaLookupField.id]).toEqual('B1');

      const newLinkField = await convertField(table1.id, sourceLinkField.id, newFieldRo);

      expect(newLinkField).toMatchObject({
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table3.id,
          lookupFieldId: table3.fields[0].id,
        },
      });

      await updateRecordByApi(table1.id, table1.records[0].id, newLinkField.id, {
        id: table3.records[0].id,
      });

      const targetLookupField = await getField(table1.id, sourceLookupField.id);
      const targetFormulaLinkField = await getField(table1.id, sourceFormulaLinkField.id);
      const targetFormulaLookupField = await getField(table1.id, sourceFormulaLookupField.id);

      expect(targetLookupField.hasError).toBeTruthy();
      expect(targetFormulaLinkField.hasError).toBeUndefined();
      expect(targetFormulaLookupField.hasError).toBeUndefined();

      // make sure records has been updated
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[newLinkField.id]).toEqual({ id: table3.records[0].id, title: 'C1' });
      expect(records[0].fields[targetLookupField.id]).toEqual('B1');
      expect(records[0].fields[targetFormulaLinkField.id]).toEqual('C1');
      expect(records[0].fields[targetFormulaLookupField.id]).toEqual('B1');
    });

    it('should mark lookupField error when convert link to text', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      const sourceLinkField = await createField(table1.id, sourceFieldRo);

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: sourceLinkField.id,
        },
      };
      const sourceLookupField = await createField(table1.id, lookupFieldRo);

      const formulaLinkFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${sourceLinkField.id}}`,
        },
      };
      const formulaLookupFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${sourceLookupField.id}}`,
        },
      };

      const sourceFormulaLinkField = await createField(table1.id, formulaLinkFieldRo);
      const sourceFormulaLookupField = await createField(table1.id, formulaLookupFieldRo);

      await updateRecordByApi(table1.id, table1.records[0].id, sourceLinkField.id, {
        id: table2.records[0].id,
      });

      // make sure records has been updated
      const { records: rs } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(rs[0].fields[sourceLinkField.id]).toEqual({ id: table2.records[0].id, title: 'B1' });
      expect(rs[0].fields[sourceLookupField.id]).toEqual('B1');
      expect(rs[0].fields[sourceFormulaLinkField.id]).toEqual('B1');
      expect(rs[0].fields[sourceFormulaLookupField.id]).toEqual('B1');

      const newField = await convertField(table1.id, sourceLinkField.id, newFieldRo);

      expect(newField).toMatchObject({
        type: FieldType.SingleLineText,
      });

      await updateRecordByApi(table1.id, table1.records[0].id, newField.id, 'txt');

      const targetLookupField = await getField(table1.id, sourceLookupField.id);
      const targetFormulaLinkField = await getField(table1.id, sourceFormulaLinkField.id);
      const targetFormulaLookupField = await getField(table1.id, sourceFormulaLookupField.id);

      expect(targetLookupField.hasError).toBeTruthy();
      expect(targetFormulaLinkField.hasError).toBeUndefined();
      expect(targetFormulaLookupField.hasError).toBeUndefined();

      // make sure records has been updated
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[newField.id]).toEqual('txt');
      expect(records[0].fields[targetLookupField.id]).toEqual('B1');
      expect(records[0].fields[targetFormulaLinkField.id]).toEqual('txt');
      expect(records[0].fields[targetFormulaLookupField.id]).toEqual('B1');
    });

    it('should convert link from one table to another and change relationship', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const newFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table3.id,
        },
      };

      // set primary key in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'z2');
      // set primary key in table3
      await updateRecordByApi(table3.id, table3.records[0].id, table3.fields[0].id, 'x');
      await updateRecordByApi(table3.id, table3.records[1].id, table3.fields[0].id, 'y');
      await updateRecordByApi(table3.id, table3.records[2].id, table3.fields[0].id, 'z3');

      const { newField, sourceField, values } = await expectUpdate(
        table1,
        sourceFieldRo,
        newFieldRo,
        [{ id: table2.records[0].id }, { id: table2.records[1].id }, { id: table2.records[2].id }],
        async (sourceField) => {
          await createField(table1.id, {
            type: FieldType.SingleLineText,
            isLookup: true,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          });
          await createField(table1.id, {
            type: FieldType.Rollup,
            options: {
              expression: `count({values})`,
              formatting: {
                precision: 2,
                type: 'decimal',
              },
            } as IRollupFieldOptions,
            lookupOptions: {
              foreignTableId: table2.id,
              lookupFieldId: table2.fields[0].id,
              linkFieldId: sourceField.id,
            },
          });
        }
      );

      // make sure symmetricField have been deleted
      const sourceFieldOptions = sourceField.options as ILinkFieldOptions;
      const newFieldOptions = newField.options as ILinkFieldOptions;
      await getField(sourceFieldOptions.foreignTableId, sourceFieldOptions.symmetricFieldId!, 404);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table3.id,
          lookupFieldId: table3.fields[0].id,
        },
      });

      // make sure symmetricField have been created
      const symmetricField = await getField(table3.id, newFieldOptions.symmetricFieldId as string);
      expect(symmetricField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Json,
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          symmetricFieldId: newField.id,
        },
      });

      const { records } = await getRecords(table3.id, { fieldKeyType: FieldKeyType.Id });
      expect(values[0]).toEqual([{ title: 'x', id: records[0].id }]);
      expect(values[1]).toEqual([{ title: 'y', id: records[1].id }]);
      expect(values[2]).toBeUndefined();
    });
  });

  describe('convert lookup field', () => {
    bfAf();

    it('should convert text to many-one lookup', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual('x');
    });

    it('should convert text to one-many lookup', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x'/'y' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'y');
      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const { newField, values } = await expectUpdate(table1, sourceFieldRo, newFieldRo, [null]);
      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
        },
      });

      expect(values[0]).toEqual(['x', 'y']);
    });

    it('should convert text field to select and relational one-many lookup field', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      const sourceField = await createField(table2.id, sourceFieldRo);

      const lookupFieldRo: IFieldRo = {
        name: 'lookup ' + sourceField.name,
        type: sourceField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      };
      const lookupField = await createField(table1.id, lookupFieldRo);

      expect(lookupField).toMatchObject({
        type: sourceField.type,
        dbFieldType: DbFieldType.Json,
        isMultipleCellValue: true,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      });

      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      // update source field record before convert
      await updateRecordByApi(table2.id, table2.records[0].id, sourceField.id, 'text 1');
      await updateRecordByApi(table2.id, table2.records[1].id, sourceField.id, 'text 2');

      const recordResult1 = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordResult1.records[0].fields[lookupField.id]).toEqual(['text 1', 'text 2']);

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleSelect,
      };

      const newField = await convertField(table2.id, sourceField.id, newFieldRo);
      const newLookupField = await getField(table1.id, lookupField.id);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'text 1' }, { name: 'text 2' }],
        },
      });

      expect(newLookupField).toMatchObject({
        type: newField.type,
        isLookup: true,
        dbFieldType: DbFieldType.Json,
        cellValueType: newField.cellValueType,
        isMultipleCellValue: true,
        options: newField.options,
        lookupOptions: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      });

      const recordResult2 = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordResult2.records[0].fields[lookupField.id]).toEqual(['text 1', 'text 2']);
    });

    it('should convert text field to number and relational one-many lookup field', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      const sourceField = await createField(table2.id, sourceFieldRo);

      const lookupFieldRo: IFieldRo = {
        name: 'lookup ' + sourceField.name,
        type: sourceField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      };
      const lookupField = await createField(table1.id, lookupFieldRo);

      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
      ]);

      // update source field record before convert
      await updateRecordByApi(table2.id, table2.records[0].id, sourceField.id, '1');

      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
      };

      const newField = await convertField(table2.id, sourceField.id, newFieldRo);
      const newLookupField = await getField(table1.id, lookupField.id);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Number,
        options: {
          formatting: {
            precision: 2,
            type: NumberFormattingType.Decimal,
          },
        },
      });

      expect(newLookupField).toMatchObject({
        type: newField.type,
        isLookup: true,
        dbFieldType: DbFieldType.Json,
        cellValueType: newField.cellValueType,
        isMultipleCellValue: true,
        options: newField.options,
        lookupOptions: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      });

      const recordResult2 = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordResult2.records[0].fields[lookupField.id]).toEqual([1]);
    });

    it('should convert date field to number and relational one-many lookup field', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Date,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      const sourceField = await createField(table2.id, sourceFieldRo);

      expect(sourceField).toMatchObject({
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
          },
        },
      });

      const lookupFieldRo: IFieldRo = {
        name: 'lookup ' + sourceField.name,
        type: sourceField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      };
      const lookupField = await createField(table1.id, lookupFieldRo);

      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
      ]);

      // update source field record before convert
      await updateRecordByApi(
        table2.id,
        table2.records[0].id,
        sourceField.id,
        new Date().toISOString()
      );

      const newFieldRo: IFieldRo = {
        type: FieldType.Number,
      };

      const newField = await convertField(table2.id, sourceField.id, newFieldRo);
      const newLookupField = await getField(table1.id, lookupField.id);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        type: FieldType.Number,
        options: {
          formatting: {
            precision: 2,
            type: NumberFormattingType.Decimal,
          },
        },
      });

      expect(newLookupField).toMatchObject({
        type: newField.type,
        isLookup: true,
        dbFieldType: DbFieldType.Json,
        cellValueType: newField.cellValueType,
        isMultipleCellValue: true,
        options: newField.options,
        lookupOptions: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      });

      const recordResult2 = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordResult2.records[0].fields[lookupField.id]).toEqual([new Date().getFullYear()]);
    });

    it('should convert number field to text and relational many-one lookup field and formula field', async () => {
      const sourceFieldRo: IFieldRo = {
        type: FieldType.Number,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      const sourceField = await createField(table2.id, sourceFieldRo);

      const lookupFieldRo: IFieldRo = {
        name: 'lookup ' + sourceField.name,
        type: sourceField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      };
      const lookupField = await createField(table1.id, lookupFieldRo);

      const formulaFieldRo: IFieldRo = {
        type: FieldType.Formula,
        options: {
          expression: `{${lookupField.id}}`,
        },
      };
      const formulaField = await createField(table1.id, formulaFieldRo);

      expect(lookupField).toMatchObject({
        type: sourceField.type,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      });

      expect(formulaField).toMatchObject({
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Real,
        cellValueType: CellValueType.Number,
      });

      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[0].id,
      });

      // update source field record before convert
      await updateRecordByApi(table2.id, table2.records[0].id, sourceField.id, 1);

      const recordResult1 = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordResult1.records[0].fields[lookupField.id]).toEqual(1);
      expect(recordResult1.records[1].fields[lookupField.id]).toEqual(1);

      const newFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };

      const newField = await convertField(table2.id, sourceField.id, newFieldRo);
      const newLookupField = await getField(table1.id, lookupField.id);
      const newFormulaField = await getField(table1.id, formulaField.id);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
        options: {},
      });

      expect(newLookupField).toMatchObject({
        type: newField.type,
        isLookup: true,
        dbFieldType: DbFieldType.Text,
        cellValueType: newField.cellValueType,
        options: newField.options,
        lookupOptions: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: sourceField.id,
          linkFieldId: linkField.id,
        },
      });

      expect(newFormulaField).toMatchObject({
        type: FieldType.Formula,
        dbFieldType: DbFieldType.Text,
        cellValueType: newField.cellValueType,
      });

      const recordResult2 = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(recordResult2.records[0].fields[lookupField.id]).toEqual('1.00');
      expect(recordResult2.records[1].fields[lookupField.id]).toEqual('1.00');
    });

    it('should mark all relational lookup field error when the link field is convert to others', async () => {
      const sourceFieldRo: IFieldRo = {
        name: 'TextField',
        type: FieldType.SingleLineText,
      };
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const extraLinkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };
      const extraLinkField = await createField(table1.id, extraLinkFieldRo);
      expect(extraLinkField).toMatchObject({
        type: FieldType.Link,
      });
      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      const lookupField = await createField(table1.id, lookupFieldRo);
      expect(lookupField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
        },
      });
      const beforeRecord = await getRecord(table1.id, table1.records[0].id);
      expect(beforeRecord.fields[lookupField.id]).toEqual('x');

      const newField = await convertField(table1.id, linkField.id, sourceFieldRo);

      expect(newField).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
      });

      const lookupFieldAfter = await getField(table1.id, lookupField.id);
      expect(lookupFieldAfter).toMatchObject({
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        type: FieldType.SingleLineText,
        isLookup: true,
        hasError: true,
        lookupOptions: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
        },
      });

      const record = await getRecord(table1.id, table1.records[0].id);
      expect(record.fields[newField.id]).toEqual('x');
      expect(record.fields[lookupField.id]).toEqual('x');
    });

    it('should update lookup when the options of the fields being lookup are updated', async () => {
      const selectFieldRo: IFieldRo = {
        name: 'SelectField',
        type: FieldType.SingleSelect,
        options: {
          choices: [{ name: 'x', color: Colors.Cyan }],
        },
      };

      const selectField = await createField(table1.id, selectFieldRo);

      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
        },
      };

      const linkField = await createField(table2.id, linkFieldRo);

      const lookupFieldRo: IFieldRo = {
        name: 'Lookup SelectField',
        type: FieldType.SingleSelect,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: selectField.id,
          linkFieldId: linkField.id,
        },
      };

      const lookupField = await createField(table2.id, lookupFieldRo);

      expect(lookupField).toMatchObject({
        name: 'Lookup SelectField',
        type: FieldType.SingleSelect,
        isLookup: true,
        options: {
          choices: [{ name: 'x', color: Colors.Cyan }],
        },
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: selectField.id,
          linkFieldId: linkField.id,
        },
      });

      const selectFieldUpdateRo = {
        ...selectFieldRo,
        options: {
          choices: [
            ...(selectField.options as ISelectFieldOptions).choices,
            { name: 'y', color: Colors.Blue },
          ],
        },
      };

      await convertField(table1.id, selectField.id, selectFieldUpdateRo);

      const lookupFieldAfter = await getField(table2.id, lookupField.id);
      expect((lookupFieldAfter.options as ISelectFieldOptions).choices.length).toEqual(2);
      expect((lookupFieldAfter.options as ISelectFieldOptions).choices[0]).toMatchObject({
        name: 'x',
        color: Colors.Cyan,
      });
      expect((lookupFieldAfter.options as ISelectFieldOptions).choices[1]).toMatchObject({
        name: 'y',
        color: Colors.Blue,
      });
    });

    it('should update lookup when the change lookupField', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'number',
        type: FieldType.Number,
      };

      const textField = await createField(table1.id, textFieldRo);
      const numberField = await createField(table1.id, numberFieldRo);

      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };

      const linkField = await createField(table2.id, linkFieldRo);
      await updateRecordByApi(table2.id, table2.records[0].id, linkField.id, [
        {
          id: table1.records[0].id,
        },
        {
          id: table1.records[1].id,
        },
      ]);
      await updateRecordByApi(table1.id, table1.records[0].id, textField.id, 'text1');
      await updateRecordByApi(table1.id, table1.records[0].id, numberField.id, 123);

      const lookupFieldRo1: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: textField.id,
          linkFieldId: linkField.id,
        } as ILookupOptionsRo,
      };

      const lookupField = await createField(table2.id, lookupFieldRo1);

      const textRecord = await getRecord(table2.id, table2.records[0].id);
      expect(textRecord.fields[lookupField.id]).toEqual(['text1']);

      const lookupFieldRo2: IFieldRo = {
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: numberField.id,
          linkFieldId: linkField.id,
        } as ILookupOptionsRo,
      };

      const updatedLookupField = await convertField(table2.id, lookupField.id, lookupFieldRo2);
      expect(updatedLookupField).toMatchObject(lookupFieldRo2);
      const numberRecord = await getRecord(table2.id, table2.records[0].id);
      expect(numberRecord.fields[lookupField.id]).toEqual([123]);
    });

    it('should change lookupField from link to text', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField = await createField(table1.id, linkFieldRo);
      const symmetricLinkField = await getField(
        table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );
      const lookupFieldRo: IFieldRo = {
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: symmetricLinkField.id,
          linkFieldId: linkField.id,
        },
      };

      const lookupField = await createField(table1.id, lookupFieldRo);
      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const newLookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
      };

      await convertField(table1.id, lookupField.id, newLookupFieldRo);

      const linkFieldAfter = await getField(table1.id, linkField.id);
      expect(linkFieldAfter).toMatchObject(linkField);
      const records = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).records;
      expect(records[0].fields[linkField.id]).toEqual([
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);
      expect(records[0].fields[lookupField.id]).toBeUndefined();
    });

    it('should change lookupField from link to other link', async () => {
      const linkFieldRo1: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkFieldRo2: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };
      const linkField1 = await createField(table1.id, linkFieldRo1);
      const linkField2 = await createField(table1.id, linkFieldRo2);

      const lookupFieldRo: IFieldRo = {
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: (linkField1.options as ILinkFieldOptions).symmetricFieldId as string,
          linkFieldId: linkField1.id,
        },
      };

      const lookupField = await createField(table1.id, lookupFieldRo);
      // add a link record
      // record[0] for linkField1
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);
      // record[1] for linkField2
      await updateRecordByApi(table1.id, table1.records[1].id, linkField2.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      const lookupFieldRo2: IFieldRo = {
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: (linkField2.options as ILinkFieldOptions).symmetricFieldId as string,
          linkFieldId: linkField2.id,
        },
      };
      const recordsPre = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).records;
      expect(recordsPre[0].fields[lookupField.id]).toEqual([
        { id: table1.records[0].id },
        { id: table1.records[0].id },
      ]);
      await convertField(table1.id, lookupField.id, lookupFieldRo2);
      const linkField1After = await getField(table1.id, linkField1.id);
      expect(linkField1After).toMatchObject(linkField1);
      const linkField2After = await getField(table1.id, linkField2.id);
      expect(linkField2After).toMatchObject(linkField2);

      const records = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).records;
      expect(records[0].fields[linkField1.id]).toEqual([
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);
      expect(records[0].fields[linkField2.id]).toBeUndefined();
      expect(records[1].fields[linkField2.id]).toEqual([
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // record[0] for lookupField is to be undefined
      expect(records[0].fields[lookupField.id]).toBeUndefined();
      // record[1] for lookupField
      expect(records[1].fields[lookupField.id]).toEqual([
        { id: table1.records[1].id },
        { id: table1.records[1].id },
      ]);
    });

    it('should reset show as for lookup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
        options: {
          showAs: {
            type: SingleLineTextDisplayType.Email,
          },
        },
      };

      const newLookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
        options: {},
      };

      const { newField } = await expectUpdate(table1, lookupFieldRo, newLookupFieldRo, []);
      expect(newField.options).toEqual({});
    });

    it('should update show as for rollup and lookup', async () => {
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);
      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // add a link record
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
        options: {
          showAs: {
            type: SingleLineTextDisplayType.Email,
          },
        },
      };

      const newLookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
        options: {},
      };

      const rollupFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
        options: {
          expression: 'concatenate({values})',
          showAs: {
            type: SingleLineTextDisplayType.Email,
          },
        },
      };

      const newRollupFieldRo: IFieldRo = {
        type: FieldType.Rollup,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: linkField.id,
        },
        options: {
          expression: 'concatenate({values})',
        },
      };

      const { newField: newRollupField } = await expectUpdate(
        table1,
        rollupFieldRo,
        newRollupFieldRo,
        []
      );
      expect(newRollupField.options).toEqual({
        expression: 'concatenate({values})',
      });

      const { newField: newLookupField } = await expectUpdate(
        table1,
        lookupFieldRo,
        newLookupFieldRo,
        []
      );
      expect(newLookupField.options).toEqual({});
    });
  });

  describe('convert rollup field', () => {
    bfAf();

    it('should update rollup change rollup to field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'number',
        type: FieldType.Number,
      };

      const textField = await createField(table1.id, textFieldRo);
      const numberField = await createField(table1.id, numberFieldRo);

      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };

      const linkField = await createField(table2.id, linkFieldRo);
      await updateRecordByApi(table2.id, table2.records[0].id, linkField.id, [
        {
          id: table1.records[0].id,
        },
        {
          id: table1.records[1].id,
        },
      ]);

      const rollupFieldRo1: IFieldRo = {
        name: 'Roll up',
        type: FieldType.Rollup,
        options: {
          expression: `count({values})`,
          formatting: {
            precision: 2,
            type: 'decimal',
          },
        } as IRollupFieldOptions,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: textField.id,
          linkFieldId: linkField.id,
        } as ILookupOptionsRo,
      };

      const rollupField = await createField(table2.id, rollupFieldRo1);

      const rollupFieldRo2: IFieldRo = {
        type: FieldType.Rollup,
        options: {
          expression: `count({values})`,
        } as IRollupFieldOptions,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: numberField.id,
          linkFieldId: linkField.id,
        } as ILookupOptionsRo,
      };

      await convertField(table2.id, rollupField.id, rollupFieldRo2);
    });
  });
});
