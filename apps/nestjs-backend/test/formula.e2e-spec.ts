/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFilter, ILinkFieldOptionsRo, ILookupOptionsRo } from '@teable/core';
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

  describe('numeric formula functions', () => {
    const numericInput = 12.345;
    const oddExpected = (() => {
      const rounded = Math.ceil(numericInput / 3);
      return rounded % 2 !== 0 ? rounded : rounded + 1;
    })();

    const numericCases = [
      {
        name: 'ROUND',
        getExpression: () => `ROUND({${numberFieldRo.id}}, 2)`,
        expected: Math.round(numericInput * 100) / 100,
      },
      {
        name: 'ROUNDUP',
        getExpression: () => `ROUNDUP({${numberFieldRo.id}} / 7, 2)`,
        expected: Math.ceil((numericInput / 7) * 100) / 100,
      },
      {
        name: 'ROUNDDOWN',
        getExpression: () => `ROUNDDOWN({${numberFieldRo.id}} / 7, 2)`,
        expected: Math.floor((numericInput / 7) * 100) / 100,
      },
      {
        name: 'CEILING',
        getExpression: () => `CEILING({${numberFieldRo.id}} / 3)`,
        expected: Math.ceil(numericInput / 3),
      },
      {
        name: 'FLOOR',
        getExpression: () => `FLOOR({${numberFieldRo.id}} / 3)`,
        expected: Math.floor(numericInput / 3),
      },
      {
        name: 'EVEN',
        getExpression: () => `EVEN({${numberFieldRo.id}} / 3)`,
        expected: 4,
      },
      {
        name: 'ODD',
        getExpression: () => `ODD({${numberFieldRo.id}} / 3)`,
        expected: oddExpected,
      },
      {
        name: 'INT',
        getExpression: () => `INT({${numberFieldRo.id}} / 3)`,
        expected: Math.floor(numericInput / 3),
      },
      {
        name: 'ABS',
        getExpression: () => `ABS(-{${numberFieldRo.id}})`,
        expected: Math.abs(-numericInput),
      },
      {
        name: 'SQRT',
        getExpression: () => `SQRT({${numberFieldRo.id}} * {${numberFieldRo.id}})`,
        expected: Math.sqrt(numericInput * numericInput),
      },
      {
        name: 'POWER',
        getExpression: () => `POWER({${numberFieldRo.id}}, 2)`,
        expected: Math.pow(numericInput, 2),
      },
      {
        name: 'EXP',
        getExpression: () => 'EXP(1)',
        expected: Math.exp(1),
      },
      {
        name: 'LOG',
        getExpression: () => 'LOG(256, 2)',
        expected: Math.log(256) / Math.log(2),
      },
      {
        name: 'MOD',
        getExpression: () => `MOD({${numberFieldRo.id}}, 5)`,
        expected: numericInput % 5,
      },
      {
        name: 'VALUE',
        getExpression: () => 'VALUE("1234.5")',
        expected: 1234.5,
      },
    ] as const;

    it.each(numericCases)('should evaluate $name', async ({ getExpression, expected, name }) => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: numericInput,
              [textFieldRo.name]: 'numeric',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const formulaField = await createField(table1Id, {
        name: `numeric-${name.toLowerCase()}`,
        type: FieldType.Formula,
        options: {
          expression: getExpression(),
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const value = recordAfterFormula.data.fields[formulaField.name];
      expect(typeof value).toBe('number');
      expect(value as number).toBeCloseTo(expected, 9);
    });
  });

  describe('text formula functions', () => {
    const numericInput = 12.345;
    const textInput = 'Teable Rocks';

    const textCases: Array<{
      name: string;
      getExpression: () => string;
      expected: string | number;
      textValue?: string;
    }> = [
      {
        name: 'CONCATENATE',
        getExpression: () => `CONCATENATE({${textFieldRo.id}}, "-", "END")`,
        expected: `${textInput}-END`,
      },
      {
        name: 'LEFT',
        getExpression: () => `LEFT({${textFieldRo.id}}, 6)`,
        expected: textInput.slice(0, 6),
      },
      {
        name: 'RIGHT',
        getExpression: () => `RIGHT({${textFieldRo.id}}, 5)`,
        expected: textInput.slice(-5),
      },
      {
        name: 'MID',
        getExpression: () => `MID({${textFieldRo.id}}, 8, 3)`,
        expected: textInput.slice(7, 10),
      },
      {
        name: 'REPLACE',
        getExpression: () => `REPLACE({${textFieldRo.id}}, 8, 5, "World")`,
        expected: `${textInput.slice(0, 7)}World`,
      },
      {
        name: 'REGEXP_REPLACE',
        getExpression: () => `REGEXP_REPLACE({${textFieldRo.id}}, "[aeiou]", "#")`,
        expected: textInput.replace(/[aeiou]/g, '#'),
      },
      {
        name: 'REGEXP_REPLACE email local part',
        textValue: 'olivia@example.com',
        getExpression: () => `"user name:" & REGEXP_REPLACE({${textFieldRo.id}}, '@.*', '')`,
        expected: 'user name:olivia',
      },
      {
        name: 'SUBSTITUTE',
        getExpression: () => `SUBSTITUTE({${textFieldRo.id}}, "e", "E")`,
        expected: textInput.replace(/e/g, 'E'),
      },
      {
        name: 'LOWER',
        getExpression: () => `LOWER({${textFieldRo.id}})`,
        expected: textInput.toLowerCase(),
      },
      {
        name: 'UPPER',
        getExpression: () => `UPPER({${textFieldRo.id}})`,
        expected: textInput.toUpperCase(),
      },
      {
        name: 'REPT',
        getExpression: () => 'REPT("Na", 3)',
        expected: 'NaNaNa',
      },
      {
        name: 'TRIM',
        getExpression: () => 'TRIM("  spaced  ")',
        expected: 'spaced',
      },
      {
        name: 'LEN',
        getExpression: () => `LEN({${textFieldRo.id}})`,
        expected: textInput.length,
      },
      {
        name: 'T',
        getExpression: () => `T({${textFieldRo.id}})`,
        expected: textInput,
      },
      {
        name: 'T (non text)',
        getExpression: () => `T({${numberFieldRo.id}})`,
        expected: numericInput.toString(),
      },
      {
        name: 'FIND',
        getExpression: () => `FIND("R", {${textFieldRo.id}})`,
        expected: textInput.indexOf('R') + 1,
      },
      {
        name: 'SEARCH',
        getExpression: () => `SEARCH("rocks", {${textFieldRo.id}})`,
        expected: textInput.toLowerCase().indexOf('rocks') + 1,
      },
      {
        name: 'ENCODE_URL_COMPONENT',
        getExpression: () => `ENCODE_URL_COMPONENT({${textFieldRo.id}})`,
        expected: textInput,
      },
    ];

    it.each(textCases)(
      'should evaluate $name',
      async ({ getExpression, expected, name, textValue }) => {
        const recordTextValue = textValue ?? textInput;
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [numberFieldRo.name]: numericInput,
                [textFieldRo.name]: recordTextValue,
              },
            },
          ],
        });
        const recordId = records[0].id;

        const formulaField = await createField(table1Id, {
          name: `text-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
          type: FieldType.Formula,
          options: {
            expression: getExpression(),
          },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];

        if (typeof expected === 'number') {
          expect(typeof value).toBe('number');
          expect(value).toBe(expected);
        } else {
          expect(value ?? null).toEqual(expected);
        }
      }
    );
  });

  describe('logical and system formula functions', () => {
    const numericInput = 12.345;
    const textInput = 'Teable Rocks';

    const logicalCases = [
      {
        name: 'IF',
        getExpression: () => `IF({${numberFieldRo.id}} > 10, "over", "under")`,
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => 'over' as const,
      },
      {
        name: 'SWITCH',
        getExpression: () => 'SWITCH(2, 1, "one", 2, "two", "other")',
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => 'two' as const,
      },
      {
        name: 'AND',
        getExpression: () => `AND({${numberFieldRo.id}} > 10, {${textFieldRo.id}} != "")`,
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => true,
      },
      {
        name: 'OR',
        getExpression: () => `OR({${numberFieldRo.id}} < 0, {${textFieldRo.id}} = "")`,
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => false,
      },
      {
        name: 'XOR',
        getExpression: () => `XOR({${numberFieldRo.id}} > 10, {${textFieldRo.id}} = "Other")`,
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => true,
      },
      {
        name: 'NOT',
        getExpression: () => `NOT({${numberFieldRo.id}} > 10)`,
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => false,
      },
      {
        name: 'BLANK',
        getExpression: () => 'BLANK()',
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => null,
      },
      {
        name: 'TEXT_ALL',
        getExpression: () => `TEXT_ALL({${textFieldRo.id}})`,
        resolveExpected: (_ctx: {
          recordId: string;
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => textInput,
      },
      {
        name: 'RECORD_ID',
        getExpression: () => 'RECORD_ID()',
        resolveExpected: ({ recordId }: { recordId: string }) => recordId,
      },
      {
        name: 'AUTO_NUMBER',
        getExpression: () => 'AUTO_NUMBER()',
        resolveExpected: ({
          recordAfter,
        }: {
          recordAfter: Awaited<ReturnType<typeof getRecord>>;
        }) => recordAfter.data.autoNumber ?? null,
      },
    ] as const;

    it.each(logicalCases)(
      'should evaluate $name',
      async ({ getExpression, resolveExpected, name }) => {
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [numberFieldRo.name]: numericInput,
                [textFieldRo.name]: textInput,
              },
            },
          ],
        });
        const recordId = records[0].id;

        const formulaField = await createField(table1Id, {
          name: `logic-${name.toLowerCase()}`,
          type: FieldType.Formula,
          options: {
            expression: getExpression(),
          },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        const expectedValue = resolveExpected({ recordId, recordAfter: recordAfterFormula });

        if (typeof expectedValue === 'boolean') {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(expectedValue);
        } else if (typeof expectedValue === 'number') {
          expect(typeof value).toBe('number');
          expect(value).toBe(expectedValue);
        } else {
          expect(value ?? null).toEqual(expectedValue);
        }
      }
    );
  });

  describe('field reference formulas', () => {
    const fieldCases = [
      {
        name: 'date field formatting',
        createFieldInput: () => ({
          name: 'Date Field',
          type: FieldType.Date,
        }),
        setValue: '2025-06-15T00:00:00.000Z',
        buildExpression: (fieldId: string) => `DATETIME_FORMAT({${fieldId}}, 'YYYY-MM-DD')`,
        assert: (value: unknown) => {
          expect(value).toBe('2025-06-15');
        },
      },
      {
        name: 'rating field numeric formula',
        createFieldInput: () => ({
          name: 'Rating Field',
          type: FieldType.Rating,
          options: { icon: 'star', max: 5, color: 'yellowBright' },
        }),
        setValue: 3,
        buildExpression: (fieldId: string) => `ROUND({${fieldId}})`,
        assert: (value: unknown) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(3);
        },
      },
      {
        name: 'checkbox field conditional',
        createFieldInput: () => ({
          name: 'Checkbox Field',
          type: FieldType.Checkbox,
        }),
        setValue: true,
        buildExpression: (fieldId: string) => `IF({${fieldId}}, "checked", "unchecked")`,
        assert: (value: unknown) => {
          expect(value).toBe('checked');
        },
      },
    ] as const;

    it.each(fieldCases)(
      'should evaluate formula referencing $name',
      async ({ createFieldInput, setValue, buildExpression, assert }) => {
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [numberFieldRo.name]: 1,
                [textFieldRo.name]: 'field-ref',
              },
            },
          ],
        });
        const recordId = records[0].id;

        const relatedField = await createField(table1Id, createFieldInput());

        await updateRecord(table1Id, recordId, {
          fieldKeyType: FieldKeyType.Name,
          record: {
            fields: {
              [relatedField.name]: setValue,
            },
          },
        });

        const formulaField = await createField(table1Id, {
          name: `field-ref-${relatedField.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
          type: FieldType.Formula,
          options: {
            expression: buildExpression(relatedField.id),
          },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        assert(value);
      }
    );

    it('should evaluate IF formula on checkbox to numeric values', async () => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 1,
              [textFieldRo.name]: 'checkbox-if-checked',
            },
          },
          {
            fields: {
              [numberFieldRo.name]: 2,
              [textFieldRo.name]: 'checkbox-if-unchecked',
            },
          },
          {
            fields: {
              [numberFieldRo.name]: 3,
              [textFieldRo.name]: 'checkbox-if-cleared',
            },
          },
        ],
      });

      const [checkedSource, uncheckedSource, clearedSource] = records;

      const checkboxField = await createField(table1Id, {
        name: 'Checkbox Boolean',
        type: FieldType.Checkbox,
      });

      const formulaField = await createField(table1Id, {
        name: 'Checkbox Numeric Result',
        type: FieldType.Formula,
        options: {
          expression: `IF({${checkboxField.id}}, 1, 0)`,
        },
      });

      const getFieldValue = (
        fields: Record<string, unknown>,
        field: { id: string; name: string }
      ): unknown => fields[field.name] ?? fields[field.id];

      const scenarios = [
        {
          label: 'checked',
          recordId: checkedSource.id,
          nextValue: true,
          expectedCheckbox: true,
          expectedFormula: 1,
        },
        {
          label: 'unchecked',
          recordId: uncheckedSource.id,
          nextValue: false,
          expectedCheckbox: false,
          expectedFormula: 0,
        },
        {
          label: 'cleared',
          recordId: clearedSource.id,
          nextValue: null,
          expectedCheckbox: null,
          expectedFormula: 0,
        },
      ] as const;

      for (const { recordId, nextValue, expectedCheckbox, expectedFormula, label } of scenarios) {
        await updateRecord(table1Id, recordId, {
          fieldKeyType: FieldKeyType.Name,
          record: {
            fields: {
              [checkboxField.name]: nextValue,
            },
          },
        });

        const { data: recordAfterUpdate } = await getRecord(table1Id, recordId);

        const checkboxValue = getFieldValue(recordAfterUpdate.fields, checkboxField);
        const formulaValue = getFieldValue(recordAfterUpdate.fields, formulaField);

        expect(getFieldValue(recordAfterUpdate.fields, textFieldRo)).toContain(label);

        if (nextValue === null) {
          expect(checkboxValue ?? null).toBeNull();
        } else {
          expect(Boolean(checkboxValue)).toBe(expectedCheckbox);
        }
        expect(formulaValue).toBe(expectedFormula);
        expect(typeof formulaValue).toBe('number');
      }

      const refreshed = await getRecords(table1Id);

      const recordMap = new Map(refreshed.records.map((record) => [record.id, record]));

      for (const { recordId, expectedCheckbox, expectedFormula, label } of scenarios) {
        const current = recordMap.get(recordId);
        expect(current).toBeDefined();

        const checkboxValue = getFieldValue(current!.fields, checkboxField);
        const formulaValue = getFieldValue(current!.fields, formulaField);

        if (expectedCheckbox === null) {
          expect(checkboxValue ?? null).toBeNull();
        } else {
          expect(Boolean(checkboxValue)).toBe(expectedCheckbox);
        }

        expect(typeof formulaValue).toBe('number');
        expect(formulaValue).toBe(expectedFormula);
        expect(getFieldValue(current!.fields, textFieldRo)).toContain(label);
      }
    });
  });

  describe('conditional reference formulas', () => {
    it('should evaluate formulas referencing conditional rollup fields', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-conditional-rollup-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Laptop', Status: 'Active', Amount: 70 } },
          { fields: { Title: 'Mouse', Status: 'Active', Amount: 20 } },
          { fields: { Title: 'Subscription', Status: 'Closed', Amount: 15 } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-conditional-rollup-host',
          fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Closed' } }],
        });

        const statusFieldId = foreign.fields.find((field) => field.name === 'Status')!.id;
        const amountFieldId = foreign.fields.find((field) => field.name === 'Amount')!.id;
        const statusFilterFieldId = host.fields.find((field) => field.name === 'StatusFilter')!.id;

        const rollupField = await createField(host.id, {
          name: 'Matching Amount Sum',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: amountFieldId,
            expression: 'sum({values})',
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId,
                  operator: 'is',
                  value: { type: 'field', fieldId: statusFilterFieldId },
                },
              ],
            },
          },
        } as IFieldRo);

        const formulaField = await createField(host.id, {
          name: 'Rollup Sum Mirror',
          type: FieldType.Formula,
          options: {
            expression: `{${rollupField.id}}`,
          },
        });

        const activeRecord = await getRecord(host.id, host.records[0].id);
        expect(activeRecord.data.fields[formulaField.name]).toEqual(90);

        const closedRecord = await getRecord(host.id, host.records[1].id);
        expect(closedRecord.data.fields[formulaField.name]).toEqual(15);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should evaluate formulas referencing conditional lookup fields', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-conditional-lookup-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', Status: 'Active' } },
          { fields: { Title: 'Beta', Status: 'Active' } },
          { fields: { Title: 'Gamma', Status: 'Closed' } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-conditional-lookup-host',
          fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { StatusFilter: 'Active' } }, { fields: { StatusFilter: 'Closed' } }],
        });

        const titleFieldId = foreign.fields.find((field) => field.name === 'Title')!.id;
        const statusFieldId = foreign.fields.find((field) => field.name === 'Status')!.id;
        const statusFilterFieldId = host.fields.find((field) => field.name === 'StatusFilter')!.id;

        const statusMatchFilter: IFilter = {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusFieldId,
              operator: 'is',
              value: { type: 'field', fieldId: statusFilterFieldId },
            },
          ],
        };

        const lookupField = await createField(host.id, {
          name: 'Matching Titles',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: titleFieldId,
            filter: statusMatchFilter,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const formulaField = await createField(host.id, {
          name: 'Lookup Joined Titles',
          type: FieldType.Formula,
          options: {
            expression: `ARRAY_JOIN({${lookupField.id}}, ", ")`,
          },
        });

        const activeRecord = await getRecord(host.id, host.records[0].id);
        expect(activeRecord.data.fields[formulaField.name]).toEqual('Alpha, Beta');

        const closedRecord = await getRecord(host.id, host.records[1].id);
        expect(closedRecord.data.fields[formulaField.name]).toEqual('Gamma');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });
  describe('datetime formula functions', () => {
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

    const componentCases = [
      {
        name: 'YEAR',
        expression: `YEAR(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 2025,
      },
      {
        name: 'MONTH',
        expression: `MONTH(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 4,
      },
      {
        name: 'DAY',
        expression: `DAY(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 15,
      },
      {
        name: 'HOUR',
        expression: `HOUR(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 10,
      },
      {
        name: 'MINUTE',
        expression: `MINUTE(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 20,
      },
      {
        name: 'SECOND',
        expression: `SECOND(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 30,
      },
      {
        name: 'WEEKDAY',
        expression: `WEEKDAY(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 2,
      },
      {
        name: 'WEEKNUM',
        expression: `WEEKNUM(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: 16,
      },
    ] as const;

    it.each(componentCases)(
      'should evaluate %s component function',
      async ({ expression, expected, name }) => {
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [{ fields: {} }],
        });
        const recordId = records[0].id;

        const formulaField = await createField(table1Id, {
          name: `datetime-component-${name.toLowerCase()}`,
          type: FieldType.Formula,
          options: { expression },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        expect(typeof value).toBe('number');
        expect(value).toBe(expected);
      }
    );

    const formattingCases = [
      {
        name: 'DATESTR',
        expression: `DATESTR(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: '2025-04-15',
      },
      {
        name: 'TIMESTR',
        expression: `TIMESTR(DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: '10:20:30',
      },
      {
        name: 'DATETIME_FORMAT',
        expression: `DATETIME_FORMAT(DATETIME_PARSE("2025-04-15"), 'YYYY-MM-DD')`,
        expected: '2025-04-15',
      },
    ] as const;

    it.each(formattingCases)(
      'should evaluate %s formatting function',
      async ({ expression, expected, name }) => {
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [{ fields: {} }],
        });
        const recordId = records[0].id;

        const formulaField = await createField(table1Id, {
          name: `datetime-format-${name.toLowerCase()}`,
          type: FieldType.Formula,
          options: { expression },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        expect(value).toBe(expected);
      }
    );

    const comparisonCases = [
      {
        name: 'IS_AFTER',
        expression: `IS_AFTER(DATETIME_PARSE("2025-04-16T12:30:45Z"), DATETIME_PARSE("2025-04-15T10:20:30Z"))`,
        expected: true,
      },
      {
        name: 'IS_BEFORE',
        expression: `IS_BEFORE(DATETIME_PARSE("2025-04-15T10:20:30Z"), DATETIME_PARSE("2025-04-16T12:30:45Z"))`,
        expected: true,
      },
    ] as const;

    it.each(comparisonCases)(
      'should evaluate %s boolean comparison',
      async ({ expression, expected, name }) => {
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [{ fields: {} }],
        });
        const recordId = records[0].id;

        const formulaField = await createField(table1Id, {
          name: `datetime-compare-${name.toLowerCase()}`,
          type: FieldType.Formula,
          options: { expression },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        expect(value).toBe(expected);
      }
    );
  });

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
