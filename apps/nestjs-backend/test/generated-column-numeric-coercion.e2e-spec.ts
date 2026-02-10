/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  getRecord,
  initApp,
  permanentDeleteTable,
  updateRecordByApi,
} from './utils/init-app';

const toUtcDateString = (date: Date) => {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date passed to toUtcDateString helper');
  }
  return date.toISOString().slice(0, 10);
};
const addUtcDays = (date: Date, days: number) => {
  const utcStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utcStart.setUTCDate(utcStart.getUTCDate() + days);
  return utcStart;
};
const shiftDateString = (value: unknown, days: number, fallback: Date) => {
  let base = typeof value === 'string' ? new Date(value) : undefined;
  if (!base || Number.isNaN(base.getTime())) {
    base = new Date(fallback);
  }
  const utcStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  utcStart.setUTCDate(utcStart.getUTCDate() + days);
  return toUtcDateString(utcStart);
};

describe('Generated column numeric coercion (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('text fields in arithmetic formulas', () => {
    let table: ITableFullVo;
    let durationField: IFieldVo;
    let consumedField: IFieldVo;
    let remainingField: IFieldVo;
    let progressField: IFieldVo;

    beforeEach(async () => {
      const seedFields: IFieldRo[] = [
        {
          name: 'Planned Duration',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Consumed Days',
          type: FieldType.SingleLineText,
        },
      ];

      table = await createTable(baseId, {
        name: 'generated_numeric_coercion',
        fields: seedFields,
        records: [
          {
            fields: {
              'Planned Duration': '10天',
              'Consumed Days': '3',
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      durationField = fieldMap.get('Planned Duration')!;
      consumedField = fieldMap.get('Consumed Days')!;

      remainingField = await createField(table.id, {
        name: 'Remaining Days',
        type: FieldType.Formula,
        options: {
          expression: `{${durationField.id}} - {${consumedField.id}}`,
        },
      });

      progressField = await createField(table.id, {
        name: 'Progress',
        type: FieldType.Formula,
        options: {
          expression: `{${consumedField.id}} / {${durationField.id}}`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('coerces numeric strings when updating generated columns', async () => {
      const recordId = table.records[0].id;

      const createdRecord = await getRecord(table.id, recordId);
      expect(createdRecord.fields[remainingField.id]).toBe(7);
      expect(createdRecord.fields[progressField.id]).toBeCloseTo(3 / 10, 2);

      await expect(
        updateRecordByApi(table.id, recordId, consumedField.id, '4天')
      ).resolves.toBeDefined();

      const updatedRecord = await getRecord(table.id, recordId);
      expect(updatedRecord.fields[remainingField.id]).toBe(6);
      expect(updatedRecord.fields[progressField.id]).toBeCloseTo(4 / 10, 2);

      await expect(
        updateRecordByApi(table.id, recordId, durationField.id, '12周')
      ).resolves.toBeDefined();

      const finalRecord = await getRecord(table.id, recordId);
      expect(finalRecord.fields[remainingField.id]).toBe(8);
      expect(finalRecord.fields[progressField.id]).toBeCloseTo(4 / 12, 2);
    });
  });

  describe('blank arithmetic operands', () => {
    let table: ITableFullVo;
    let valueField: IFieldVo;
    let optionalField: IFieldVo;
    let addField: IFieldVo;
    let subtractField: IFieldVo;
    let multiplyField: IFieldVo;
    let divideValueByOptionalField: IFieldVo;
    let divideOptionalByValueField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'generated_blank_arithmetic',
        fields: [
          {
            name: 'Value',
            type: FieldType.Number,
          },
          {
            name: 'Optional',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              Value: 10,
            },
          },
          {
            fields: {
              Optional: 4,
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      valueField = fieldMap.get('Value')!;
      optionalField = fieldMap.get('Optional')!;

      addField = await createField(table.id, {
        name: 'Add',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} + {${optionalField.id}}`,
        },
      });

      subtractField = await createField(table.id, {
        name: 'Subtract',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} - {${optionalField.id}}`,
        },
      });

      multiplyField = await createField(table.id, {
        name: 'Multiply',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} * {${optionalField.id}}`,
        },
      });

      divideValueByOptionalField = await createField(table.id, {
        name: 'Value / Optional',
        type: FieldType.Formula,
        options: {
          expression: `{${valueField.id}} / {${optionalField.id}}`,
        },
      });

      divideOptionalByValueField = await createField(table.id, {
        name: 'Optional / Value',
        type: FieldType.Formula,
        options: {
          expression: `{${optionalField.id}} / {${valueField.id}}`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('treats blank operands as zero in arithmetic formulas', async () => {
      const [valueOnlyRecord, optionalOnlyRecord] = table.records;

      const recordWithValue = await getRecord(table.id, valueOnlyRecord.id);
      expect(recordWithValue.fields[addField.id]).toBe(10);
      expect(recordWithValue.fields[subtractField.id]).toBe(10);
      expect(recordWithValue.fields[multiplyField.id]).toBe(0);
      expect(recordWithValue.fields[divideOptionalByValueField.id]).toBe(0);
      expect(recordWithValue.fields[divideValueByOptionalField.id]).toBeUndefined();

      const recordWithOptional = await getRecord(table.id, optionalOnlyRecord.id);
      expect(recordWithOptional.fields[addField.id]).toBe(4);
      expect(recordWithOptional.fields[subtractField.id]).toBe(-4);
      expect(recordWithOptional.fields[multiplyField.id]).toBe(0);
      expect(recordWithOptional.fields[divideValueByOptionalField.id]).toBe(0);
      expect(recordWithOptional.fields[divideOptionalByValueField.id]).toBeUndefined();
    });
  });

  describe('date arithmetic with generated formulas', () => {
    let table: ITableFullVo;
    let dueDateField: IFieldVo;
    let bufferDaysField: IFieldVo;
    let startDateField: IFieldVo;
    let statusField: IFieldVo;
    let dueDateUtc!: Date;

    beforeEach(async () => {
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      dueDateUtc = addUtcDays(todayUtc, 5);
      const dueDateValue = toUtcDateString(dueDateUtc);

      table = await createTable(baseId, {
        name: 'generated_date_arithmetic',
        fields: [
          {
            name: 'Due Date',
            type: FieldType.Date,
          },
          {
            name: 'Buffer Days',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              'Due Date': dueDateValue,
              'Buffer Days': 2,
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      dueDateField = fieldMap.get('Due Date')!;
      bufferDaysField = fieldMap.get('Buffer Days')!;

      startDateField = await createField(table.id, {
        name: 'Start Date',
        type: FieldType.Formula,
        options: {
          expression: `DATESTR({${dueDateField.id}} - {${bufferDaysField.id}})`,
        },
      });

      statusField = await createField(table.id, {
        name: 'Status',
        type: FieldType.Formula,
        options: {
          expression: `IF({${dueDateField.id}} - {${bufferDaysField.id}} <= TODAY(),"ready","pending")`,
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('supports date minus numeric operands and comparisons with TODAY()', async () => {
      const recordId = table.records[0].id;
      const initialRecord = await getRecord(table.id, recordId);
      const storedDueDate = initialRecord.fields[dueDateField.id] as string | undefined;
      const expectedInitialLead = shiftDateString(storedDueDate, -2, dueDateUtc);
      expect(initialRecord.fields[startDateField.id]).toBe(expectedInitialLead);
      expect(initialRecord.fields[statusField.id]).toBe('pending');

      await updateRecordByApi(table.id, recordId, bufferDaysField.id, 7);

      const updatedRecord = await getRecord(table.id, recordId);
      const updatedDueDate = updatedRecord.fields[dueDateField.id] as string | undefined;
      const expectedUpdatedLead = shiftDateString(updatedDueDate, -7, dueDateUtc);
      expect(updatedRecord.fields[startDateField.id]).toBe(expectedUpdatedLead);
      expect(updatedRecord.fields[statusField.id]).toBe('ready');
    });
  });

  describe('workday diff with numeric inputs', () => {
    let table: ITableFullVo;
    let monthField: IFieldVo;
    let workdayDiffField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'generated_workday_numeric',
        fields: [
          {
            name: 'Month Number',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              'Month Number': 8,
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      monthField = fieldMap.get('Month Number')!;

      workdayDiffField = await createField(table.id, {
        name: 'Workdays Delta',
        type: FieldType.Formula,
        options: {
          expression: `WORKDAY_DIFF({${monthField.id}} + 1, {${monthField.id}})`,
          timeZone: 'Etc/GMT-8',
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('returns null instead of raising a cast error', async () => {
      const recordId = table.records[0].id;

      const createdRecord = await getRecord(table.id, recordId);
      expect(createdRecord.fields[workdayDiffField.id] ?? null).toBeNull();

      await expect(updateRecordByApi(table.id, recordId, monthField.id, 12)).resolves.toBeDefined();

      const updatedRecord = await getRecord(table.id, recordId);
      expect(updatedRecord.fields[workdayDiffField.id] ?? null).toBeNull();
    });
  });

  describe('workday with date and numeric field inputs (regression)', () => {
    let table: ITableFullVo;
    let dateField: IFieldVo;
    let numberField: IFieldVo;
    let workdayField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'generated_workday_date_number',
        fields: [
          {
            name: 'Date',
            type: FieldType.Date,
          },
          {
            name: 'Number',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              Date: '2026-01-22',
              Number: 1,
            },
          },
        ],
      });

      const fieldMap = new Map(table.fields.map((field) => [field.name, field]));
      dateField = fieldMap.get('Date')!;
      numberField = fieldMap.get('Number')!;

      workdayField = await createField(table.id, {
        name: 'Workday Date',
        type: FieldType.Formula,
        options: {
          expression: `DATESTR(WORKDAY({${dateField.id}}, {${numberField.id}}))`,
          timeZone: 'Asia/Shanghai',
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('creates field and computes date when days parameter references number field', async () => {
      const recordId = table.records[0].id;
      const createdRecord = await getRecord(table.id, recordId);
      expect(createdRecord.fields[workdayField.id]).toBe('2026-01-23');

      await expect(updateRecordByApi(table.id, recordId, numberField.id, 3)).resolves.toBeDefined();

      const updatedRecord = await getRecord(table.id, recordId);
      expect(updatedRecord.fields[workdayField.id]).toBe('2026-01-25');
    });
  });

  describe('workday diff referencing numeric formula (regression)', () => {
    let table: ITableFullVo;
    let monthFormulaField: IFieldVo;
    let workdayDiffField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'generated_workday_formula_ref',
        fields: [
          {
            name: 'Dummy',
            type: FieldType.Number,
          },
        ],
        records: [
          {
            fields: {
              Dummy: 1,
            },
          },
        ],
      });

      monthFormulaField = await createField(table.id, {
        name: 'Month Num',
        type: FieldType.Formula,
        options: {
          expression: 'MONTH(TODAY())-1',
          timeZone: 'Etc/GMT-8',
        },
      });

      workdayDiffField = await createField(table.id, {
        name: 'Month Workdays',
        type: FieldType.Formula,
        options: {
          expression: `WORKDAY_DIFF({${monthFormulaField.id}} + 1, {${monthFormulaField.id}})`,
          timeZone: 'Etc/GMT-8',
        },
      });
    });

    afterEach(async () => {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
    });

    it('returns null when numeric formula is used as date input', async () => {
      const recordId = table.records[0].id;
      const createdRecord = await getRecord(table.id, recordId);
      expect(createdRecord.fields[workdayDiffField.id] ?? null).toBeNull();
    });
  });
});
