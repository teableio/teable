/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptionsRo } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  generateFieldId,
  NumberFormattingType,
  Relationship,
} from '@teable/core';
import { getRecord, updateRecords, type ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  permanentDeleteTable,
  getRecords,
  initApp,
  updateRecord,
  convertField,
} from './utils/init-app';

describe('OpenAPI formula (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table1: ITableFullVo;
  let numberFieldRo: IFieldRo & { id: string; name: string };
  let textFieldRo: IFieldRo & { id: string; name: string };
  let formulaFieldRo: IFieldRo & { id: string; name: string };
  const baseId = globalThis.testConfig.baseId;
  const baseDate = new Date(Date.UTC(2025, 0, 3, 0, 0, 0, 0));
  const dateAddMultiplier = 7;
  const numberFieldSeedValue = 2;
  const datetimeDiffStartIso = '2025-01-01T00:00:00.000Z';
  const datetimeDiffEndIso = '2025-01-08T03:04:05.006Z';
  const datetimeDiffStart = new Date(datetimeDiffStartIso);
  const datetimeDiffEnd = new Date(datetimeDiffEndIso);
  const diffMilliseconds = datetimeDiffEnd.getTime() - datetimeDiffStart.getTime();
  const diffSeconds = diffMilliseconds / 1000;
  const diffMinutes = diffSeconds / 60;
  const diffHours = diffMinutes / 60;
  const diffDays = diffHours / 24;
  const diffWeeks = diffDays / 7;
  type DateAddNormalizedUnit =
    | 'millisecond'
    | 'second'
    | 'minute'
    | 'hour'
    | 'day'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year';
  const dateAddCases: Array<{ literal: string; normalized: DateAddNormalizedUnit }> = [
    { literal: 'day', normalized: 'day' },
    { literal: 'days', normalized: 'day' },
    { literal: 'week', normalized: 'week' },
    { literal: 'weeks', normalized: 'week' },
    { literal: 'month', normalized: 'month' },
    { literal: 'months', normalized: 'month' },
    { literal: 'quarter', normalized: 'quarter' },
    { literal: 'quarters', normalized: 'quarter' },
    { literal: 'year', normalized: 'year' },
    { literal: 'years', normalized: 'year' },
    { literal: 'hour', normalized: 'hour' },
    { literal: 'hours', normalized: 'hour' },
    { literal: 'minute', normalized: 'minute' },
    { literal: 'minutes', normalized: 'minute' },
    { literal: 'second', normalized: 'second' },
    { literal: 'seconds', normalized: 'second' },
    { literal: 'millisecond', normalized: 'millisecond' },
    { literal: 'milliseconds', normalized: 'millisecond' },
    { literal: 'ms', normalized: 'millisecond' },
    { literal: 'sec', normalized: 'second' },
    { literal: 'secs', normalized: 'second' },
    { literal: 'min', normalized: 'minute' },
    { literal: 'mins', normalized: 'minute' },
    { literal: 'hr', normalized: 'hour' },
    { literal: 'hrs', normalized: 'hour' },
  ];
  const datetimeDiffCases: Array<{ literal: string; expected: number }> = [
    { literal: 'millisecond', expected: diffMilliseconds },
    { literal: 'milliseconds', expected: diffMilliseconds },
    { literal: 'ms', expected: diffMilliseconds },
    { literal: 'second', expected: diffSeconds },
    { literal: 'seconds', expected: diffSeconds },
    { literal: 'sec', expected: diffSeconds },
    { literal: 'secs', expected: diffSeconds },
    { literal: 'minute', expected: diffMinutes },
    { literal: 'minutes', expected: diffMinutes },
    { literal: 'min', expected: diffMinutes },
    { literal: 'mins', expected: diffMinutes },
    { literal: 'hour', expected: diffHours },
    { literal: 'hours', expected: diffHours },
    { literal: 'hr', expected: diffHours },
    { literal: 'hrs', expected: diffHours },
    { literal: 'day', expected: diffDays },
    { literal: 'days', expected: diffDays },
    { literal: 'week', expected: diffWeeks },
    { literal: 'weeks', expected: diffWeeks },
  ];
  const isSameCases: Array<{ literal: string; first: string; second: string; expected: boolean }> =
    [
      {
        literal: 'day',
        first: '2025-01-05T10:00:00Z',
        second: '2025-01-05T23:59:59Z',
        expected: true,
      },
      {
        literal: 'days',
        first: '2025-01-05T08:00:00Z',
        second: '2025-01-05T12:34:56Z',
        expected: true,
      },
      {
        literal: 'hour',
        first: '2025-01-05T10:05:00Z',
        second: '2025-01-05T10:59:59Z',
        expected: true,
      },
      {
        literal: 'hours',
        first: '2025-01-05T15:00:00Z',
        second: '2025-01-05T15:45:00Z',
        expected: true,
      },
      {
        literal: 'hr',
        first: '2025-01-05T18:01:00Z',
        second: '2025-01-05T18:59:59Z',
        expected: true,
      },
      {
        literal: 'hrs',
        first: '2025-01-05T21:00:00Z',
        second: '2025-01-05T21:10:00Z',
        expected: true,
      },
      {
        literal: 'minute',
        first: '2025-01-05T10:15:30Z',
        second: '2025-01-05T10:15:59Z',
        expected: true,
      },
      {
        literal: 'minutes',
        first: '2025-01-05T11:00:00Z',
        second: '2025-01-05T11:00:59Z',
        expected: true,
      },
      {
        literal: 'min',
        first: '2025-01-05T12:34:10Z',
        second: '2025-01-05T12:34:50Z',
        expected: true,
      },
      {
        literal: 'mins',
        first: '2025-01-05T13:00:00Z',
        second: '2025-01-05T13:00:30Z',
        expected: true,
      },
      {
        literal: 'second',
        first: '2025-01-05T14:15:30Z',
        second: '2025-01-05T14:15:30Z',
        expected: true,
      },
      {
        literal: 'seconds',
        first: '2025-01-05T14:15:45Z',
        second: '2025-01-05T14:15:45Z',
        expected: true,
      },
      {
        literal: 'sec',
        first: '2025-01-05T14:20:15Z',
        second: '2025-01-05T14:20:15Z',
        expected: true,
      },
      {
        literal: 'secs',
        first: '2025-01-05T14:25:40Z',
        second: '2025-01-05T14:25:40Z',
        expected: true,
      },
      {
        literal: 'month',
        first: '2025-01-05T10:00:00Z',
        second: '2025-01-30T12:00:00Z',
        expected: true,
      },
      {
        literal: 'months',
        first: '2025-01-01T00:00:00Z',
        second: '2025-01-31T23:59:59Z',
        expected: true,
      },
      {
        literal: 'year',
        first: '2025-01-01T00:00:00Z',
        second: '2025-12-31T23:59:59Z',
        expected: true,
      },
      {
        literal: 'years',
        first: '2025-03-15T00:00:00Z',
        second: '2025-11-20T23:59:59Z',
        expected: true,
      },
      {
        literal: 'week',
        first: '2025-01-06T08:00:00Z',
        second: '2025-01-11T22:00:00Z',
        expected: true,
      },
      {
        literal: 'weeks',
        first: '2025-01-06T00:00:00Z',
        second: '2025-01-12T23:59:59Z',
        expected: true,
      },
    ];
  const addToDate = (date: Date, count: number, unit: DateAddNormalizedUnit): Date => {
    const clone = new Date(date.getTime());
    switch (unit) {
      case 'millisecond':
        clone.setUTCMilliseconds(clone.getUTCMilliseconds() + count);
        break;
      case 'second':
        clone.setUTCSeconds(clone.getUTCSeconds() + count);
        break;
      case 'minute':
        clone.setUTCMinutes(clone.getUTCMinutes() + count);
        break;
      case 'hour':
        clone.setUTCHours(clone.getUTCHours() + count);
        break;
      case 'day':
        clone.setUTCDate(clone.getUTCDate() + count);
        break;
      case 'week':
        clone.setUTCDate(clone.getUTCDate() + count * 7);
        break;
      case 'month':
        clone.setUTCMonth(clone.getUTCMonth() + count);
        break;
      case 'quarter':
        clone.setUTCMonth(clone.getUTCMonth() + count * 3);
        break;
      case 'year':
        clone.setUTCFullYear(clone.getUTCFullYear() + count);
        break;
      default:
        throw new Error(`Unsupported unit: ${unit}`);
    }
    return clone;
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    numberFieldRo = {
      id: generateFieldId(),
      name: 'Number field',
      description: 'the number field',
      type: FieldType.Number,
      options: {
        formatting: { type: NumberFormattingType.Decimal, precision: 1 },
      },
    };

    textFieldRo = {
      id: generateFieldId(),
      name: 'text field',
      description: 'the text field',
      type: FieldType.SingleLineText,
    };

    formulaFieldRo = {
      id: generateFieldId(),
      name: 'New field',
      description: 'the new field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} & {${textFieldRo.id}}`,
      },
    };

    table1 = await createTable(baseId, {
      name: 'table1',
      fields: [numberFieldRo, textFieldRo, formulaFieldRo],
    });
    table1Id = table1.id;
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table1Id);
  });

  it('should response calculate record after create', async () => {
    const recordResult = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [numberFieldRo.name]: 1,
            [textFieldRo.name]: 'x',
          },
        },
      ],
    });

    const record = recordResult.records[0];
    expect(record.fields[numberFieldRo.name]).toEqual(1);
    expect(record.fields[textFieldRo.name]).toEqual('x');
    expect(record.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should response calculate record after update multi record field', async () => {
    const getResult = await getRecords(table1Id);

    const existRecord = getResult.records[0];

    const record = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [numberFieldRo.name]: 1,
          [textFieldRo.name]: 'x',
        },
      },
    });

    expect(record.fields[numberFieldRo.name]).toEqual(1);
    expect(record.fields[textFieldRo.name]).toEqual('x');
    expect(record.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should response calculate record after update single record field', async () => {
    const getResult = await getRecords(table1Id);

    const existRecord = getResult.records[0];

    const record1 = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [numberFieldRo.name]: 1,
        },
      },
    });

    expect(record1.fields[numberFieldRo.name]).toEqual(1);
    expect(record1.fields[textFieldRo.name]).toBeUndefined();
    expect(record1.fields[formulaFieldRo.name]).toEqual('1');

    const record2 = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'x',
        },
      },
    });

    expect(record2.fields[numberFieldRo.name]).toEqual(1);
    expect(record2.fields[textFieldRo.name]).toEqual('x');
    expect(record2.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should concatenate strings with plus operator when operands are blank', async () => {
    const plusNumberSuffixField = await createField(table1Id, {
      name: 'plus-number-suffix',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} + ''`,
      },
    });

    const plusNumberPrefixField = await createField(table1Id, {
      name: 'plus-number-prefix',
      type: FieldType.Formula,
      options: {
        expression: `'' + {${numberFieldRo.id}}`,
      },
    });

    const plusTextSuffixField = await createField(table1Id, {
      name: 'plus-text-suffix',
      type: FieldType.Formula,
      options: {
        expression: `{${textFieldRo.id}} + ''`,
      },
    });

    const plusTextPrefixField = await createField(table1Id, {
      name: 'plus-text-prefix',
      type: FieldType.Formula,
      options: {
        expression: `'' + {${textFieldRo.id}}`,
      },
    });

    const plusMixedField = await createField(table1Id, {
      name: 'plus-mixed-field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} + {${textFieldRo.id}}`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [numberFieldRo.name]: 1,
          },
        },
      ],
    });

    const createdRecord = records[0];
    expect(createdRecord.fields[plusNumberSuffixField.name]).toEqual('1');
    expect(createdRecord.fields[plusNumberPrefixField.name]).toEqual('1');
    expect(createdRecord.fields[plusTextSuffixField.name]).toEqual('');
    expect(createdRecord.fields[plusTextPrefixField.name]).toEqual('');
    expect(createdRecord.fields[plusMixedField.name]).toEqual('1');

    const updatedRecord = await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'x',
        },
      },
    });

    expect(updatedRecord.fields[plusNumberSuffixField.name]).toEqual('1');
    expect(updatedRecord.fields[plusNumberPrefixField.name]).toEqual('1');
    expect(updatedRecord.fields[plusTextSuffixField.name]).toEqual('x');
    expect(updatedRecord.fields[plusTextPrefixField.name]).toEqual('x');
    expect(updatedRecord.fields[plusMixedField.name]).toEqual('1x');
  });

  it('should treat empty string comparison as blank in formula condition', async () => {
    const equalsEmptyField = await createField(table1Id, {
      name: 'equals empty string',
      type: FieldType.Formula,
      options: {
        expression: `IF({${textFieldRo.id}}="", 1, 0)`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {},
        },
      ],
    });

    const createdRecord = records[0];
    const fetchedRecord = await getRecord(table1Id, createdRecord.id);
    expect(createdRecord.fields[equalsEmptyField.name]).toEqual(1);
    expect(fetchedRecord.data.fields[equalsEmptyField.name]).toEqual(1);

    const filledRecord = await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'value',
        },
      },
    });

    expect(filledRecord.fields[equalsEmptyField.name]).toEqual(0);

    const clearedRecord = await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: '',
        },
      },
    });

    expect(clearedRecord.fields[equalsEmptyField.name]).toEqual(1);
  });

  it('should calculate formula containing question mark literal', async () => {
    const urlFormulaField = await createField(table1Id, {
      name: 'url formula',
      type: FieldType.Formula,
      options: {
        expression: `'https://example.com/?id=' & {${textFieldRo.id}}`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [textFieldRo.name]: 'abc',
          },
        },
      ],
    });

    expect(records[0].fields[urlFormulaField.name]).toEqual('https://example.com/?id=abc');
  });

  it.each(dateAddCases)(
    'should evaluate DATE_ADD with expression-based count argument for unit "%s"',
    async ({ literal, normalized }) => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: numberFieldSeedValue,
            },
          },
        ],
      });
      const recordId = records[0].id;

      const dateAddField = await createField(table1Id, {
        name: `date-add-formula-${literal}`,
        type: FieldType.Formula,
        options: {
          expression: `DATE_ADD(DATETIME_PARSE("2025-01-03"), {${numberFieldRo.id}} * ${dateAddMultiplier}, '${literal}')`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const rawValue = recordAfterFormula.data.fields[dateAddField.name];
      expect(typeof rawValue).toBe('string');
      const value = rawValue as string;
      const expectedCount = numberFieldSeedValue * dateAddMultiplier;
      const expectedDate = addToDate(baseDate, expectedCount, normalized);
      const expectedIso = expectedDate.toISOString();
      expect(value).toEqual(expectedIso);
    }
  );

  it.each(datetimeDiffCases)(
    'should evaluate DATETIME_DIFF for unit "%s"',
    async ({ literal, expected }) => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 1,
            },
          },
        ],
      });
      const recordId = records[0].id;

      const diffField = await createField(table1Id, {
        name: `datetime-diff-${literal}`,
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_DIFF(DATETIME_PARSE("${datetimeDiffStartIso}"), DATETIME_PARSE("${datetimeDiffEndIso}"), '${literal}')`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const rawValue = recordAfterFormula.data.fields[diffField.name];
      if (typeof rawValue === 'number') {
        expect(rawValue).toBeCloseTo(expected, 6);
      } else {
        const numericValue = Number(rawValue);
        expect(Number.isFinite(numericValue)).toBe(true);
        expect(numericValue).toBeCloseTo(expected, 6);
      }
    }
  );

  it.each(isSameCases)(
    'should evaluate IS_SAME for unit "%s"',
    async ({ literal, first, second, expected }) => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [textFieldRo.name]: 'value',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const sameField = await createField(table1Id, {
        name: `is-same-${literal}`,
        type: FieldType.Formula,
        options: {
          expression: `IS_SAME(DATETIME_PARSE("${first}"), DATETIME_PARSE("${second}"), '${literal}')`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const rawValue = recordAfterFormula.data.fields[sameField.name];
      expect(rawValue).toBe(expected);
    }
  );

  it('should calculate primary field when have link relationship', async () => {
    const table2: ITableFullVo = await createTable(baseId, { name: 'table2' });
    const linkFieldRo: IFieldRo = {
      type: FieldType.Link,
      options: {
        foreignTableId: table2.id,
        relationship: Relationship.ManyOne,
      } as ILinkFieldOptionsRo,
    };

    const formulaFieldRo: IFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: `{${table2.fields[0].id}}`,
      },
    };

    await createField(table1Id, linkFieldRo);

    const formulaField = await createField(table2.id, formulaFieldRo);

    const record1 = await updateRecord(table2.id, table2.records[0].id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [table2.fields[0].name]: 'text',
        },
      },
    });
    expect(record1.fields[formulaField.name]).toEqual('text');
  });

  describe('safe calculate', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table safe' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should safe calculate error function', async () => {
      const field = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: "'x'*10",
        },
      });

      expect(field).toBeDefined();
    });

    it('should calculate formula with timeZone', async () => {
      const field1 = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: "DAY('2024-02-29T00:00:00+08:00')",
          timeZone: 'Asia/Shanghai',
        },
      });

      const record1 = await getRecord(table.id, table.records[0].id);
      expect(record1.data.fields[field1.name]).toEqual(29);

      const field2 = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: "DAY('2024-02-28T00:00:00+09:00')",
          timeZone: 'Asia/Shanghai',
        },
      });

      const record2 = await getRecord(table.id, table.records[0].id);
      expect(record2.data.fields[field2.name]).toEqual(27);
    });

    it.skip('should evaluate boolean formulas with timezone aware date arguments', async () => {
      const dateField = await createField(table.id, {
        name: 'Boolean date',
        type: FieldType.Date,
      });

      const recordId = table.records[0].id;
      await updateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [dateField.name]: '2024-03-01T00:00:00+08:00',
          },
        },
      });

      const andField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `AND(IS_AFTER({${dateField.id}}, '2024-02-28T23:00:00+08:00'), IS_BEFORE({${dateField.id}}, '2024-03-01T12:00:00+08:00'))`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const recordAfterAnd = await getRecord(table.id, recordId);
      expect(recordAfterAnd.data.fields[andField.name]).toEqual(true);

      const orField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `OR(IS_AFTER({${dateField.id}}, '2024-03-01T12:00:00+08:00'), IS_SAME(DATETIME_PARSE('2024-03-01T00:00:00+08:00'), {${dateField.id}}, 'minute'))`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const recordAfterOr = await getRecord(table.id, recordId);
      expect(recordAfterOr.data.fields[orField.name]).toEqual(true);

      const ifField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `IF(IS_AFTER({${dateField.id}}, '2024-02-29T00:00:00+09:00'), 'after', 'before')`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const recordAfterIf = await getRecord(table.id, recordId);
      expect(recordAfterIf.data.fields[ifField.name]).toEqual('after');
    });

    it('should calculate auto number and number field', async () => {
      const autoNumberField = await createField(table.id, {
        name: 'ttttttt',
        type: FieldType.AutoNumber,
      });

      const numberField = await createField(table.id, {
        type: FieldType.Number,
      });
      const numberField1 = await createField(table.id, {
        type: FieldType.Number,
      });

      await updateRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: table.records.map((record) => ({
          id: record.id,
          fields: {
            [numberField.name]: 2,
            [numberField1.name]: 3,
          },
        })),
      });

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${autoNumberField.id}} & "-" & {${numberField.id}} & "-" & {${numberField1.id}}`,
        },
      });

      const record = await getRecords(table.id);
      expect(record.records[0].fields[formulaField.name]).toEqual('1-2-3');
      expect(record.records[0].fields[autoNumberField.name]).toEqual(1);

      await convertField(table.id, formulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${autoNumberField.id}} & "-" & {${numberField.id}}`,
        },
      });

      const record2 = await getRecord(table.id, table.records[0].id);
      expect(record2.data.fields[autoNumberField.name]).toEqual(1);
      expect(record2.data.fields[formulaField.name]).toEqual('1-2');

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberField.name]: 22,
          },
        },
      });

      const record3 = await getRecord(table.id, table.records[0].id);
      expect(record3.data.fields[formulaField.name]).toEqual('1-22');
      expect(record2.data.fields[autoNumberField.name]).toEqual(1);
    });

    it('should convert blank-aware formulas referencing created time field', async () => {
      const recordId = table.records[0].id;
      const createdTimeField = await createField(table.id, {
        name: 'created-time',
        type: FieldType.CreatedTime,
      });

      const placeholderField = await createField(table.id, {
        name: 'created-count',
        type: FieldType.SingleLineText,
      });

      const countFormulaField = await convertField(table.id, placeholderField.id, {
        type: FieldType.Formula,
        options: {
          expression: `COUNTA({${createdTimeField.id}})`,
        },
      });

      const recordAfterFirstConvert = await getRecord(table.id, recordId);
      expect(recordAfterFirstConvert.data.fields[countFormulaField.name]).toEqual(1);

      const updatedCountFormulaField = await convertField(table.id, countFormulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `COUNTA({${createdTimeField.id}}, {${createdTimeField.id}})`,
        },
      });

      const recordAfterSecondConvert = await getRecord(table.id, recordId);
      expect(recordAfterSecondConvert.data.fields[updatedCountFormulaField.name]).toEqual(2);

      const countFormula = await convertField(table.id, updatedCountFormulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `COUNT({${createdTimeField.id}})`,
        },
      });

      const recordAfterCount = await getRecord(table.id, recordId);
      expect(recordAfterCount.data.fields[countFormula.name]).toEqual(1);

      const countAllFormula = await convertField(table.id, countFormula.id, {
        type: FieldType.Formula,
        options: {
          expression: `COUNTALL({${createdTimeField.id}})`,
        },
      });

      const recordAfterCountAll = await getRecord(table.id, recordId);
      expect(recordAfterCountAll.data.fields[countAllFormula.name]).toEqual(1);
    });

    it('should update record by name wile have create last modified field', async () => {
      await createField(table.id, {
        type: FieldType.LastModifiedTime,
      });

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [table.fields[0].name]: '1',
          },
        },
      });

      const record = await getRecord(table.id, table.records[0].id);
      expect(record.data.fields[table.fields[0].name]).toEqual('1');
    });
  });
});
