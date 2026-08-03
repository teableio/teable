/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type {
  FormulaFieldCore,
  IFieldVo,
  INumberFieldOptions,
  IRatingFieldOptions,
} from '@teable/core';
import {
  Colors,
  DateFormattingPreset,
  FieldKeyType,
  FieldType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  deleteBase,
  deleteTable,
  getRecord,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI Formula Field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create formula field', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      // Create a table with various field types for testing
      table = await createTable(baseId, {
        name: 'Formula Test Table',
        fields: [
          {
            name: 'Text Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Number Field',
            type: FieldType.Number,
            options: {
              formatting: { type: 'decimal', precision: 2 },
            } as INumberFieldOptions,
          },
          {
            name: 'Date Field',
            type: FieldType.Date,
          },
          {
            name: 'Rating Field',
            type: FieldType.Rating,
            options: {
              icon: 'star',
              max: 5,
              color: 'yellowBright',
            } as IRatingFieldOptions,
          },
          {
            name: 'Checkbox Field',
            type: FieldType.Checkbox,
          },
          {
            name: 'Select Field',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'Option A', color: Colors.Blue },
                { name: 'Option B', color: Colors.Red },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              'Text Field': 'Hello World',
              'Number Field': 42.5,
              'Date Field': '2024-01-15',
              'Rating Field': 4,
              'Checkbox Field': true,
              'Select Field': 'Option A',
            },
          },
          {
            fields: {
              'Text Field': 'Test String',
              'Number Field': 100,
              'Date Field': '2024-02-20',
              'Rating Field': 3,
              'Checkbox Field': false,
              'Select Field': 'Option B',
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should create formula referencing text field', async () => {
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Text Formula',
        options: {
          expression: `UPPER({${textFieldId}})`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);
      expect((formulaField as FormulaFieldCore).options.expression).toBe(`UPPER({${textFieldId}})`);

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('HELLO WORLD');
      expect(records[1].fields[formulaField.id]).toBe('TEST STRING');
    });

    it('should create formula referencing number field', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Number Formula',
        options: {
          expression: `{${numberFieldId}} * 2`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(85);
      expect(records[1].fields[formulaField.id]).toBe(200);
    });

    it('should create formula referencing date field', async () => {
      const dateFieldId = table.fields.find((f) => f.name === 'Date Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Date Formula',
        options: {
          expression: `YEAR({${dateFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(2024);
      expect(records[1].fields[formulaField.id]).toBe(2024);
    });

    it('should create formula referencing rating field', async () => {
      const ratingFieldId = table.fields.find((f) => f.name === 'Rating Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Rating Formula',
        options: {
          expression: `{${ratingFieldId}} + 1`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(5);
      expect(records[1].fields[formulaField.id]).toBe(4);
    });

    it('should create formula referencing checkbox field', async () => {
      const checkboxFieldId = table.fields.find((f) => f.name === 'Checkbox Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Checkbox Formula',
        options: {
          expression: `IF({${checkboxFieldId}}, "Yes", "No")`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Yes');
      expect(records[1].fields[formulaField.id]).toBe('No');
    });

    it('should create formula referencing select field', async () => {
      const selectFieldId = table.fields.find((f) => f.name === 'Select Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Select Formula',
        options: {
          expression: `CONCATENATE("Selected: ", {${selectFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Selected: Option A');
      expect(records[1].fields[formulaField.id]).toBe('Selected: Option B');
    });

    it('should substitute numeric field as text', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Number Substitute',
        options: {
          expression: `SUBSTITUTE({${numberFieldId}}, "0", "X")`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('42.5');
      expect(records[1].fields[formulaField.id]).toBe('1XX');
    });

    it('should create formula with multiple field references', async () => {
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Multi Field Formula',
        options: {
          expression: `CONCATENATE({${textFieldId}}, " - ", {${numberFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Hello World - 42.5');
      expect(records[1].fields[formulaField.id]).toBe('Test String - 100');
    });
  });

  describe('formula recalculation on record creation', () => {
    let table: ITableFullVo;
    let statusFieldId: string;
    let statusFormulaFieldId: string;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Formula Status Table',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Status',
            type: FieldType.SingleLineText,
          },
        ],
      });

      statusFieldId = table.fields.find((f) => f.name === 'Status')!.id;

      const statusFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Status Formula',
        options: {
          expression: `IF({${statusFieldId}}="", 1, 222222)`,
        },
      });

      statusFormulaFieldId = statusFormulaField.id;
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should calculate formula when referenced field is omitted on creation', async () => {
      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              Name: 'Missing status',
            },
          },
        ],
      });

      const createdRecordId = created.records[0].id;
      const record = await getRecord(table.id, createdRecordId);

      expect(record.fields[statusFieldId]).toBeUndefined();
      expect(record.fields[statusFormulaFieldId]).toBe(1);
    });

    it('should calculate alternate branch when referenced field has value', async () => {
      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              Name: 'Has status',
              Status: 'done',
            },
          },
        ],
      });

      const createdRecordId = created.records[0].id;
      const record = await getRecord(table.id, createdRecordId);

      expect(record.fields[statusFormulaFieldId]).toBe(222222);
    });
  });

  describe('formula recalculation referencing lookup dependencies', () => {
    let mainTable: ITableFullVo;
    let foreignTable: ITableFullVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let formulaFieldId: string;
    let nameFieldId: string;

    beforeEach(async () => {
      foreignTable = await createTable(baseId, {
        name: 'Lookup Source Table',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { Title: 'Item A' } }, { fields: { Title: 'Item B' } }],
      });

      mainTable = await createTable(baseId, {
        name: 'Lookup Host Table',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
        ],
      });

      nameFieldId = mainTable.fields.find((f) => f.name === 'Name')!.id;

      linkField = await createField(mainTable.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: foreignTable.id,
        },
      });

      const titleFieldId = foreignTable.fields.find((f) => f.name === 'Title')!.id;

      lookupField = await createField(mainTable.id, {
        type: FieldType.SingleLineText,
        name: 'Lookup Title',
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          lookupFieldId: titleFieldId,
          linkFieldId: linkField.id,
        },
      });

      const formulaField = await createField(mainTable.id, {
        type: FieldType.Formula,
        name: 'Lookup Formula',
        options: {
          expression: `IF({${lookupField.id}}="", "no lookup", {${lookupField.id}})`,
        },
      });

      formulaFieldId = formulaField.id;
    });

    afterEach(async () => {
      if (mainTable?.id) {
        await deleteTable(baseId, mainTable.id);
      }
      if (foreignTable?.id) {
        await deleteTable(baseId, foreignTable.id);
      }
    });

    it('should compute lookup-based formula when link is omitted on creation', async () => {
      const created = await createRecords(mainTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [nameFieldId]: 'No link',
            },
          },
        ],
      });

      const record = await getRecord(mainTable.id, created.records[0].id);
      expect(record.fields[formulaFieldId]).toBe('no lookup');
    });

    it('should compute lookup-based formula when link is provided on creation', async () => {
      const created = await createRecords(mainTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [nameFieldId]: 'Linked record',
              [linkField.id]: { id: foreignTable.records[0].id },
            },
          },
        ],
      });

      const record = await getRecord(mainTable.id, created.records[0].id);
      expect(record.fields[lookupField.id]).toBe('Item A');
      expect(record.fields[formulaFieldId]).toBe('Item A');
    });
  });

  describe('lookup formula with blank single select lookup', () => {
    let foreignBaseId: string;
    let ordersTable: ITableFullVo;
    let followupTable: ITableFullVo;
    let linkFieldId: string;
    let statusLookupFieldId: string;
    let planLookupFieldId: string;
    let formulaFieldId: string;
    let titleFieldId: string;

    beforeEach(async () => {
      const spaceId = globalThis.testConfig.spaceId;
      const createdBase = await createBase({ spaceId, name: 'Cross Base Orders' });
      foreignBaseId = createdBase.id;

      ordersTable = await createTable(foreignBaseId, {
        name: 'Orders',
        fields: [
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'Paid', color: Colors.Green },
                { name: 'Deposit', color: Colors.Blue },
              ],
            },
          },
          {
            name: 'Plan',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'Plan2', color: Colors.Cyan },
                { name: 'Plan3', color: Colors.Orange },
                { name: 'Other', color: Colors.Gray },
              ],
            },
          },
        ],
        records: [
          { fields: { Status: 'Paid', Plan: 'Plan2' } },
          { fields: { Status: 'Deposit', Plan: 'Plan3' } },
        ],
      });

      followupTable = await createTable(baseId, {
        name: 'Order Followups',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
        ],
      });

      titleFieldId = followupTable.fields.find((f) => f.name === 'Title')!.id;

      const linkField = await createField(followupTable.id, {
        name: 'Order',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: ordersTable.id,
          isOneWay: true,
        },
      });

      linkFieldId = linkField.id;

      const statusFieldId = ordersTable.fields.find((f) => f.name === 'Status')!.id;
      const planFieldId = ordersTable.fields.find((f) => f.name === 'Plan')!.id;

      const statusLookupField = await createField(followupTable.id, {
        name: 'Lookup Status',
        type: FieldType.SingleSelect,
        isLookup: true,
        lookupOptions: {
          foreignTableId: ordersTable.id,
          lookupFieldId: statusFieldId,
          linkFieldId,
        },
      });

      statusLookupFieldId = statusLookupField.id;

      const planLookupField = await createField(followupTable.id, {
        name: 'Lookup Plan',
        type: FieldType.SingleSelect,
        isLookup: true,
        lookupOptions: {
          foreignTableId: ordersTable.id,
          lookupFieldId: planFieldId,
          linkFieldId,
        },
      });

      planLookupFieldId = planLookupField.id;

      const formulaField = await createField(followupTable.id, {
        name: 'Status Notice',
        type: FieldType.Formula,
        options: {
          expression: `IF(
            {${statusLookupFieldId}}="Paid",
            "No reminder",
            IF(
              AND(
                {${statusLookupFieldId}}="Deposit",
                OR(
                  {${planLookupFieldId}}="Plan2",
                  {${planLookupFieldId}}="Plan3"
                )
              ),
              "Installment follow-up",
              IF(
                AND(
                  {${statusLookupFieldId}}="Deposit",
                  NOT(
                    OR(
                      {${planLookupFieldId}}="Plan2",
                      {${planLookupFieldId}}="Plan3"
                    )
                  )
                ),
                "Tail follow-up",
                IF(
                  {${statusLookupFieldId}}="",
                  "Tail follow-up",
                  "Tail follow-up"
                )
              )
            )
          )`,
        },
      });

      formulaFieldId = formulaField.id;
    });

    afterEach(async () => {
      if (followupTable?.id) {
        await deleteTable(baseId, followupTable.id);
      }
      if (ordersTable?.id && foreignBaseId) {
        await permanentDeleteTable(foreignBaseId, ordersTable.id);
      }
      if (foreignBaseId) {
        await deleteBase(foreignBaseId);
      }
    });

    it('should fallback when lookup is blank', async () => {
      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Unlinked order',
            },
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[statusLookupFieldId] ?? null).toBeNull();
      expect(record.fields[planLookupFieldId] ?? null).toBeNull();
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('should use lookup value when record is linked', async () => {
      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: 'Linked order',
              [linkFieldId]: { id: ordersTable.records[0].id },
            },
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[statusLookupFieldId]).toBe('Paid');
      expect(record.fields[planLookupFieldId]).toBe('Plan2');
      expect(record.fields[formulaFieldId]).toBe('No reminder');
    });

    it('should still fallback when record is created without other field values', async () => {
      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {},
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[statusLookupFieldId] ?? null).toBeNull();
      expect(record.fields[planLookupFieldId] ?? null).toBeNull();
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('should fallback even if reference table is missing entries', async () => {
      const prisma = app.get(PrismaService);
      await prisma.reference.deleteMany({
        where: { fromFieldId: linkFieldId },
      });
      await prisma.reference.deleteMany({
        where: { toFieldId: { in: [statusLookupFieldId, planLookupFieldId] } },
      });

      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {},
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('should fallback when the only field sent is explicitly null', async () => {
      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [titleFieldId]: null,
            },
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[statusLookupFieldId] ?? null).toBeNull();
      expect(record.fields[planLookupFieldId] ?? null).toBeNull();
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('should fallback even if lookup-to-formula references are missing', async () => {
      const prisma = app.get(PrismaService);
      await prisma.reference.deleteMany({
        where: {
          OR: [
            { fromFieldId: linkFieldId },
            { toFieldId: linkFieldId },
            { fromFieldId: { in: [statusLookupFieldId, planLookupFieldId] } },
            { toFieldId: { in: [statusLookupFieldId, planLookupFieldId, formulaFieldId] } },
          ],
        },
      });

      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {},
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('should fallback even if lookup fields are not marked computed', async () => {
      const prisma = app.get(PrismaService);
      await prisma.field.updateMany({
        where: { id: { in: [statusLookupFieldId, planLookupFieldId] } },
        data: { isComputed: false },
      });
      await prisma.reference.deleteMany({
        where: { fromFieldId: { in: [linkFieldId, statusLookupFieldId, planLookupFieldId] } },
      });

      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {},
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });

    it('should fallback even if reference graph is completely missing', async () => {
      const prisma = app.get(PrismaService);
      await prisma.reference.deleteMany({});

      const created = await createRecords(followupTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {},
          },
        ],
      });

      const record = await getRecord(followupTable.id, created.records[0].id);
      expect(record.fields[formulaFieldId]).toBe('Tail follow-up');
    });
  });

  describe('create formula referencing formula', () => {
    let table: ITableFullVo;
    let baseFormulaField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Nested Formula Test Table',
        fields: [
          {
            name: 'Number Field',
            type: FieldType.Number,
          },
        ],
        records: [{ fields: { 'Number Field': 10 } }, { fields: { 'Number Field': 20 } }],
      });

      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      // Create base formula field
      baseFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Base Formula',
        options: {
          expression: `{${numberFieldId}} * 2`,
        },
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should create formula referencing another formula', async () => {
      const nestedFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Nested Formula',
        options: {
          expression: `{${baseFormulaField.id}} + 5`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[nestedFormulaField.id]).toBe(25); // (10 * 2) + 5
      expect(records[1].fields[nestedFormulaField.id]).toBe(45); // (20 * 2) + 5
    });

    it('should create complex nested formula', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const complexFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Complex Formula',
        options: {
          expression: `IF({${baseFormulaField.id}} > {${numberFieldId}}, "Greater", "Not Greater")`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[complexFormulaField.id]).toBe('Greater'); // 20 > 10
      expect(records[1].fields[complexFormulaField.id]).toBe('Greater'); // 40 > 20
    });
  });

  describe('create formula with link, lookup and rollup fields', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let rollupField: IFieldVo;

    beforeEach(async () => {
      // Create first table
      table1 = await createTable(baseId, {
        name: 'Main Table',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { Name: 'Record 1' } }, { fields: { Name: 'Record 2' } }],
      });

      // Create second table
      table2 = await createTable(baseId, {
        name: 'Related Table',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Value',
            type: FieldType.Number,
          },
        ],
        records: [
          { fields: { Title: 'Item A', Value: 100 } },
          { fields: { Title: 'Item B', Value: 200 } },
        ],
      });

      // Create link field
      linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });

      // Link records
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[1].id,
      });

      // Create lookup field
      const titleFieldId = table2.fields.find((f) => f.name === 'Title')!.id;
      lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        name: 'Lookup Title',
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: titleFieldId,
          linkFieldId: linkField.id,
        },
      });

      // Create rollup field
      const valueFieldId = table2.fields.find((f) => f.name === 'Value')!.id;
      rollupField = await createField(table1.id, {
        type: FieldType.Rollup,
        name: 'Rollup Value',
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: valueFieldId,
          linkFieldId: linkField.id,
        },
      });
    });

    afterEach(async () => {
      if (table1?.id) {
        await deleteTable(baseId, table1.id);
      }
      if (table2?.id) {
        await deleteTable(baseId, table2.id);
      }
    });

    it('should create formula referencing lookup field', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Lookup Formula',
        options: {
          expression: `{${lookupField.id}}`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);
      expect((formulaField as FormulaFieldCore).options.expression).toBe(`{${lookupField.id}}`);

      // Verify the formula field calculates correctly
      const records = await getRecords(table1.id);
      expect(records.records).toHaveLength(2);

      const record1 = records.records[0];
      const formulaValue1 = record1.fields[formulaField.id];
      const lookupValue1 = record1.fields[lookupField.id];

      // Formula should return the same value as the lookup field
      expect(formulaValue1).toEqual(lookupValue1);
    });

    it('should create formula referencing rollup field', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Rollup Formula',
        options: {
          expression: `{${rollupField.id}} * 2`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);
      expect((formulaField as FormulaFieldCore).options.expression).toBe(`{${rollupField.id}} * 2`);

      // Verify the formula field calculates correctly
      const records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records.records).toHaveLength(2);

      const record1 = records.records[0];
      const formulaValue1 = record1.fields[formulaField.id];
      const rollupValue1 = record1.fields[rollupField.id] as number;

      // Formula should return rollup value multiplied by 2
      expect(formulaValue1).toBe(rollupValue1 * 2);
    });

    it('should fallback when rollup-based formula has no linked data', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Rollup Fallback',
        options: {
          expression: `IF({${rollupField.id}} > 0, "Has rollup", "No rollup")`,
        },
      });

      const created = await createRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {},
          },
        ],
      });

      const record = await getRecord(table1.id, created.records[0].id);
      expect(record.fields[formulaField.id]).toBe('No rollup');
    });

    it('should create formula referencing link field', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Link Formula',
        options: {
          expression: `IF({${linkField.id}}, "Has Link", "No Link")`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);

      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Has Link');
      expect(records[1].fields[formulaField.id]).toBe('Has Link');
    });
  });

  describe('formula referencing link display with nested lookup', () => {
    let doctors: ITableFullVo;
    let patients: ITableFullVo;
    let orders: ITableFullVo;
    let doctorLink: IFieldVo;
    let doctorNameLookup: IFieldVo;
    let patientDisplayFormula: IFieldVo;
    let patientLink: IFieldVo;
    let orderFormula: IFieldVo;
    let doctorRecordId: string;
    let patientRecordId: string;
    let patientCodeFieldId: string;
    let orderNoFieldId: string;
    let doctorNameFieldId: string;

    beforeAll(async () => {
      doctors = await createTable(baseId, {
        name: 'NestedLookup_Doctors',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Dr Smith' } }],
      });
      doctorNameFieldId = doctors.fields.find((f) => f.name === 'Name')!.id;
      doctorRecordId = doctors.records[0].id;

      patients = await createTable(baseId, {
        name: 'NestedLookup_Patients',
        fields: [{ name: 'Patient Code', type: FieldType.SingleLineText }],
      });
      patientCodeFieldId = patients.fields.find((f) => f.name === 'Patient Code')!.id;

      doctorLink = await createField(patients.id, {
        name: 'Doctor',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: doctors.id,
        },
      });

      doctorNameLookup = await createField(patients.id, {
        name: 'Doctor Name',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: doctors.id,
          linkFieldId: doctorLink.id,
          lookupFieldId: doctorNameFieldId,
        },
      });

      patientDisplayFormula = await createField(patients.id, {
        name: 'Display',
        type: FieldType.Formula,
        options: {
          expression: `{${patientCodeFieldId}} & "-" & {${doctorNameLookup.id}}`,
        },
      });

      const createdPatients = await createRecords(patients.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [patientCodeFieldId]: 'P001',
              [doctorLink.id]: { id: doctorRecordId },
            },
          },
        ],
      });
      patientRecordId = createdPatients.records[0].id;

      orders = await createTable(baseId, {
        name: 'NestedLookup_Orders',
        fields: [{ name: 'Order No', type: FieldType.SingleLineText }],
      });
      orderNoFieldId = orders.fields.find((f) => f.name === 'Order No')!.id;

      patientLink = await createField(orders.id, {
        name: 'Patient',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: patients.id,
          lookupFieldId: patientDisplayFormula.id,
        },
      });

      orderFormula = await createField(orders.id, {
        name: 'Order Summary',
        type: FieldType.Formula,
        options: {
          expression: `{${orderNoFieldId}} & "-" & {${patientLink.id}}`,
        },
      });
    });

    afterAll(async () => {
      if (orders?.id) {
        await permanentDeleteTable(baseId, orders.id);
      }
      if (patients?.id) {
        await permanentDeleteTable(baseId, patients.id);
      }
      if (doctors?.id) {
        await permanentDeleteTable(baseId, doctors.id);
      }
    });

    it('should compute formula when link display depends on lookup-of-link', async () => {
      const createdOrders = await createRecords(orders.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [orderNoFieldId]: 'ORD-1',
              [patientLink.id]: { id: patientRecordId },
            },
          },
        ],
      });

      const record = await getRecord(orders.id, createdOrders.records[0].id);
      expect(record.fields[orderFormula.id]).toBe('ORD-1-P001-Dr Smith');
    });
  });

  describe('formula using lookup datetime formatting inside concatenation', () => {
    let contractTable: ITableFullVo;
    let projectTable: ITableFullVo;
    let linkField: IFieldVo;
    let schoolLookupField: IFieldVo;
    let dateLookupField: IFieldVo;
    let projectNameFieldId: string;
    let folderFormulaFieldId: string;

    beforeEach(async () => {
      contractTable = await createTable(baseId, {
        name: 'contract-table',
        fields: [
          {
            name: 'Contract Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'School',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Planning Date',
            type: FieldType.Date,
          },
        ],
        records: [
          {
            fields: {
              'Contract Name': 'Smart Campus Upgrade',
              School: 'Shenzhen Institute',
              'Planning Date': '2024-05-20T00:00:00.000Z',
            },
          },
        ],
      });

      projectTable = await createTable(baseId, {
        name: 'project-table',
        fields: [
          {
            name: 'Project Name',
            type: FieldType.SingleLineText,
          },
        ],
      });

      projectNameFieldId = projectTable.fields.find((f) => f.name === 'Project Name')!.id;

      linkField = await createField(projectTable.id, {
        type: FieldType.Link,
        name: 'Related Contract',
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: contractTable.id,
        },
      });

      const schoolFieldId = contractTable.fields.find((f) => f.name === 'School')!.id;
      schoolLookupField = await createField(projectTable.id, {
        type: FieldType.SingleLineText,
        name: 'School Lookup',
        isLookup: true,
        lookupOptions: {
          foreignTableId: contractTable.id,
          lookupFieldId: schoolFieldId,
          linkFieldId: linkField.id,
        },
      });

      const planningDateFieldId = contractTable.fields.find((f) => f.name === 'Planning Date')!.id;
      dateLookupField = await createField(projectTable.id, {
        type: FieldType.Date,
        name: 'Planning Date Lookup',
        isLookup: true,
        lookupOptions: {
          foreignTableId: contractTable.id,
          lookupFieldId: planningDateFieldId,
          linkFieldId: linkField.id,
        },
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
            timeZone: 'Asia/Shanghai',
          },
        },
      });

      const folderFormulaField = await createField(projectTable.id, {
        type: FieldType.Formula,
        name: 'Folder Path',
        options: {
          expression: `"NAS-" & {${schoolLookupField.id}} & "-" & DATETIME_FORMAT({${dateLookupField.id}}, 'YYYYMMDD')`,
          timeZone: 'Asia/Shanghai',
        },
      });
      folderFormulaFieldId = folderFormulaField.id;
    });

    afterEach(async () => {
      if (projectTable?.id) {
        await deleteTable(baseId, projectTable.id);
      }
      if (contractTable?.id) {
        await deleteTable(baseId, contractTable.id);
      }
    });

    it('should concatenate lookup datetime output safely', async () => {
      const created = await createRecords(projectTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [projectNameFieldId]: 'NAS Folder',
              [linkField.id]: { id: contractTable.records[0].id },
            },
          },
        ],
      });

      const record = await getRecord(projectTable.id, created.records[0].id);
      expect(record.fields[folderFormulaFieldId]).toBe('NAS-Shenzhen Institute-20240520');
    });
  });

  describe('formula field indirect reference scenarios', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let rollupField: IFieldVo;

    beforeEach(async () => {
      // Create first table
      table1 = await createTable(baseId, {
        name: 'Main Table',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Value',
            type: FieldType.Number,
          },
        ],
        records: [
          { fields: { Name: 'Record 1', Value: 10 } },
          { fields: { Name: 'Record 2', Value: 20 } },
        ],
      });

      // Create second table
      table2 = await createTable(baseId, {
        name: 'Related Table',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Value',
            type: FieldType.Number,
          },
        ],
        records: [
          { fields: { Title: 'Item A', Value: 100 } },
          { fields: { Title: 'Item B', Value: 200 } },
        ],
      });

      // Create link field
      linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });

      // Link records
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[1].id,
      });

      // Create lookup field
      const titleFieldId = table2.fields.find((f) => f.name === 'Title')!.id;
      lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        name: 'Lookup Title',
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: titleFieldId,
          linkFieldId: linkField.id,
        },
      });

      // Create rollup field
      const valueFieldId = table2.fields.find((f) => f.name === 'Value')!.id;
      rollupField = await createField(table1.id, {
        type: FieldType.Rollup,
        name: 'Rollup Value',
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: valueFieldId,
          linkFieldId: linkField.id,
        },
      });
    });

    afterEach(async () => {
      if (table1?.id) {
        await deleteTable(baseId, table1.id);
      }
      if (table2?.id) {
        await deleteTable(baseId, table2.id);
      }
    });

    it('should successfully create formula that indirectly references link field through another formula', async () => {
      // First create a formula that references the link field
      const formula2 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 2',
        options: {
          expression: `IF({${linkField.id}}, "Has Link", "No Link")`,
        },
      });

      // Then create a formula that references the first formula
      const formula1 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 1',
        options: {
          expression: `CONCATENATE("Result: ", {${formula2.id}})`,
        },
      });

      expect(formula1.type).toBe(FieldType.Formula);
      expect(formula2.type).toBe(FieldType.Formula);

      // Verify the formulas work correctly
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formula1.id]).toBe('Result: Has Link');
      expect(records[1].fields[formula1.id]).toBe('Result: Has Link');
    });

    it('should successfully create formula that indirectly references lookup field through another formula', async () => {
      // First create a formula that references the lookup field
      const formula2 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 2',
        options: {
          expression: `CONCATENATE("Lookup: ", {${lookupField.id}})`,
        },
      });

      // Then create a formula that references the first formula
      const formula1 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 1',
        options: {
          expression: `UPPER({${formula2.id}})`,
        },
      });

      expect(formula1.type).toBe(FieldType.Formula);
      expect(formula2.type).toBe(FieldType.Formula);

      // Verify the formulas work correctly
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formula1.id]).toBe('LOOKUP: ITEM A');
      expect(records[1].fields[formula1.id]).toBe('LOOKUP: ITEM B');
    });

    it('should successfully create formula that indirectly references rollup field through another formula', async () => {
      // First create a formula that references the rollup field
      const formula2 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 2',
        options: {
          expression: `{${rollupField.id}} * 2`,
        },
      });

      // Then create a formula that references the first formula
      const formula1 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 1',
        options: {
          expression: `{${formula2.id}} + 10`,
        },
      });

      expect(formula1.type).toBe(FieldType.Formula);
      expect(formula2.type).toBe(FieldType.Formula);

      // Verify the formulas work correctly
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formula1.id]).toBe(210); // (100 * 2) + 10
      expect(records[1].fields[formula1.id]).toBe(410); // (200 * 2) + 10
    });

    it('should successfully create multi-level formula chain', async () => {
      // Create a chain: formula1 -> formula2 -> formula3 -> rollup field
      const formula3 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 3',
        options: {
          expression: `{${rollupField.id}}`,
        },
      });

      const formula2 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 2',
        options: {
          expression: `{${formula3.id}} * 2`,
        },
      });

      const formula1 = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Formula 1',
        options: {
          expression: `{${formula2.id}} + 5`,
        },
      });

      expect(formula1.type).toBe(FieldType.Formula);
      expect(formula2.type).toBe(FieldType.Formula);
      expect(formula3.type).toBe(FieldType.Formula);

      // Verify the formulas work correctly
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formula1.id]).toBe(205); // (100 * 2) + 5
      expect(records[1].fields[formula1.id]).toBe(405); // (200 * 2) + 5
    });
  });

  describe('formula field error scenarios', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Error Test Table',
        fields: [
          {
            name: 'Text Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Number Field',
            type: FieldType.Number,
          },
        ],
        records: [{ fields: { 'Text Field': 'Test', 'Number Field': 42 } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should fail with invalid expression syntax', async () => {
      const error = await getError(() =>
        createField(table.id, {
          type: FieldType.Formula,
          name: 'Invalid Formula',
          options: {
            expression: 'INVALID_FUNCTION({field})',
          },
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail with non-existent field reference', async () => {
      const error = await getError(() =>
        createField(table.id, {
          type: FieldType.Formula,
          name: 'Invalid Field Reference',
          options: {
            expression: '{nonExistentFieldId}',
          },
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should handle empty expression', async () => {
      const error = await getError(() =>
        createField(table.id, {
          type: FieldType.Formula,
          name: 'Empty Formula',
          options: {
            expression: '',
          },
        })
      );

      expect(error?.status).toBe(400);
    });
  });

  describe('complex formula scenarios', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Complex Formula Table',
        fields: [
          {
            name: 'First Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Last Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Age',
            type: FieldType.Number,
          },
          {
            name: 'Birth Date',
            type: FieldType.Date,
          },
          {
            name: 'Is Active',
            type: FieldType.Checkbox,
          },
          {
            name: 'Score',
            type: FieldType.Rating,
            options: { icon: 'star', max: 5, color: 'yellowBright' } as IRatingFieldOptions,
          },
        ],
        records: [
          {
            fields: {
              'First Name': 'John',
              'Last Name': 'Doe',
              Age: 30,
              'Birth Date': '1994-01-15',
              'Is Active': true,
              Score: 4,
            },
          },
          {
            fields: {
              'First Name': 'Jane',
              'Last Name': 'Smith',
              Age: 25,
              'Birth Date': '1999-06-20',
              'Is Active': false,
              Score: 5,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should create formula with string concatenation', async () => {
      const firstNameId = table.fields.find((f) => f.name === 'First Name')!.id;
      const lastNameId = table.fields.find((f) => f.name === 'Last Name')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Full Name',
        options: {
          expression: `CONCATENATE({${firstNameId}}, " ", {${lastNameId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('John Doe');
      expect(records[1].fields[formulaField.id]).toBe('Jane Smith');
    });

    it('should create formula with conditional logic', async () => {
      const ageId = table.fields.find((f) => f.name === 'Age')!.id;
      const isActiveId = table.fields.find((f) => f.name === 'Is Active')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Status',
        options: {
          expression: `IF(AND({${ageId}} >= 18, {${isActiveId}}), "Adult Active", IF({${ageId}} >= 18, "Adult Inactive", "Minor"))`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Adult Active');
      expect(records[1].fields[formulaField.id]).toBe('Adult Inactive');
    });

    it('should create formula with mathematical operations', async () => {
      const ageId = table.fields.find((f) => f.name === 'Age')!.id;
      const scoreId = table.fields.find((f) => f.name === 'Score')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Weighted Score',
        options: {
          expression: `ROUND(({${scoreId}} * {${ageId}}) / 10, 2)`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(12); // (4 * 30) / 10 = 12
      expect(records[1].fields[formulaField.id]).toBe(12.5); // (5 * 25) / 10 = 12.5
    });

    it('should create formula with date functions', async () => {
      const birthDateId = table.fields.find((f) => f.name === 'Birth Date')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Birth Year',
        options: {
          expression: `YEAR({${birthDateId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(1994);
      expect(records[1].fields[formulaField.id]).toBe(1999);
    });
  });

  describe('localized single select numeric coercion', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Localized Duration Formula',
        fields: [
          {
            name: '定型时长',
            type: FieldType.SingleSelect,
            options: {
              preventAutoNewOptions: true,
              choices: [
                { name: '0分钟', color: Colors.GrayDark1 },
                { name: '20分钟', color: Colors.BlueLight1 },
                { name: '30分钟', color: Colors.BlueBright },
              ],
            },
          },
        ],
        records: [
          { fields: { 定型时长: '0分钟' } },
          { fields: { 定型时长: '20分钟' } },
          { fields: { 定型时长: '30分钟' } },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('parses localized option labels through VALUE()', async () => {
      const durationFieldId = table.fields.find((f) => f.name === '定型时长')!.id;

      const numericField = await createField(table.id, {
        type: FieldType.Formula,
        name: '定型时长(数值)',
        options: {
          expression: `VALUE({${durationFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      const parsedValues = records.map((record) => record.fields[numericField.id]);
      expect(parsedValues).toEqual([0, 20, 30]);
    });
  });
});
