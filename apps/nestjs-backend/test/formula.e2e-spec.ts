/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFilter,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
  ISelectFieldOptionsRo,
} from '@teable/core';
import {
  DateFormattingPreset,
  DbFieldType,
  FieldKeyType,
  FieldType,
  FunctionName,
  generateFieldId,
  NumberFormattingType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import { getRecord, updateRecords, type ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  permanentDeleteTable,
  getRecords,
  getField,
  initApp,
  updateRecord,
  updateRecordByApi,
  convertField,
} from './utils/init-app';

describe('OpenAPI formula (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let table1: ITableFullVo;
  let numberFieldRo: IFieldRo & { id: string; name: string };
  let textFieldRo: IFieldRo & { id: string; name: string };
  let formulaFieldRo: IFieldRo & { id: string; name: string };
  let userFieldRo: IFieldRo & { id: string; name: string };
  let multiSelectFieldRo: IFieldRo & { id: string; name: string };
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
    { literal: 's', expected: diffSeconds },
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
    { literal: 'h', expected: diffHours },
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
    // Ensure real timers are active before any API calls
    // This prevents Keyv cache issues caused by vi.useFakeTimers()
    vi.useRealTimers();

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

    userFieldRo = {
      id: generateFieldId(),
      name: 'assignee',
      description: 'the user field',
      type: FieldType.User,
      options: {
        isMultiple: false,
        shouldNotify: false,
      },
    };

    multiSelectFieldRo = {
      id: generateFieldId(),
      name: 'tags',
      description: 'the multi select field',
      type: FieldType.MultipleSelect,
      options: {
        choices: [
          { id: 'tag-alpha', name: 'Alpha' },
          { id: 'tag-beta', name: 'Beta' },
        ],
      } as ISelectFieldOptionsRo,
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
      name: `table-${Date.now()}`,
      fields: [numberFieldRo, textFieldRo, userFieldRo, multiSelectFieldRo, formulaFieldRo],
    });
    table1Id = table1.id;
  });

  afterEach(async () => {
    // IMPORTANT: Restore real timers before any API calls to prevent Keyv cache issues.
    // vi.useFakeTimers() interferes with Keyv's Date.now()-based TTL checks,
    // causing session data to be incorrectly treated as expired or deleted.
    vi.useRealTimers();
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
    // V1 returns '1x', V2 returns '1.0x' (applies number formatting)
    expect(record.fields[formulaFieldRo.name]).toMatch(/^1(\.0)?x$/);
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
    // V1 returns '1x', V2 returns '1.0x' (applies number formatting)
    expect(record.fields[formulaFieldRo.name]).toMatch(/^1(\.0)?x$/);
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
    // V1 returns '1', V2 returns '1.0' (applies number formatting)
    expect(record1.fields[formulaFieldRo.name]).toMatch(/^1(\.0)?$/);

    const record2 = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'x',
        },
      },
    });

    // V1 returns all fields, V2 only returns updated fields + computed fields
    // So numberFieldRo may be 1 (V1) or undefined (V2)
    expect([1, undefined]).toContain(record2.fields[numberFieldRo.name]);
    expect(record2.fields[textFieldRo.name]).toEqual('x');
    // V1 returns '1x', V2 returns '1.0x' (applies number formatting)
    expect(record2.fields[formulaFieldRo.name]).toMatch(/^1(\.0)?x$/);
  });

  it('should batch update records referencing spaced curly field identifiers', async () => {
    const spacedFormulaField = await createField(table1Id, {
      name: 'spaced-curly-formula',
      type: FieldType.Formula,
      options: {
        expression: `{ ${numberFieldRo.id} } & '-' & {   ${textFieldRo.id}   }`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [numberFieldRo.name]: 5,
            [textFieldRo.name]: 'old',
          },
        },
      ],
    });
    const recordId = records[0].id;

    const response = await updateRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          id: recordId,
          fields: {
            [numberFieldRo.name]: 10,
            [textFieldRo.name]: 'fresh',
          },
        },
      ],
    });

    expect(response.status).toBe(200);

    const { data: updatedRecord } = await getRecord(table1Id, recordId);
    expect(updatedRecord.fields?.[formulaFieldRo.name]).toEqual('10fresh');
    expect(updatedRecord.fields?.[spacedFormulaField.name]).toEqual('10-fresh');
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

    await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'x',
        },
      },
    });

    // Fetch the full record to verify all computed field values
    const updatedRecord = await getRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
    });

    expect(updatedRecord.data.fields[plusNumberSuffixField.name]).toEqual('1');
    expect(updatedRecord.data.fields[plusNumberPrefixField.name]).toEqual('1');
    expect(updatedRecord.data.fields[plusTextSuffixField.name]).toEqual('x');
    expect(updatedRecord.data.fields[plusTextPrefixField.name]).toEqual('x');
    expect(updatedRecord.data.fields[plusMixedField.name]).toEqual('1x');
  });

  it('should safely update numeric formulas that add multi-value fields', async () => {
    let foreign: ITableFullVo | undefined;

    try {
      foreign = await createTable(baseId, {
        name: 'lookup-multi-number-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Effort',
            type: FieldType.Number,
            options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
          } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Task A', Effort: 3 } },
          { fields: { Title: 'Task B', Effort: 7 } },
        ],
      });

      const effortField = foreign.fields.find((field) => field.name === 'Effort');
      expect(effortField).toBeDefined();

      const linkField = await createField(table1Id, {
        name: 'linked-tasks',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreign.id,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const lookupField = await createField(table1Id, {
        name: 'linked-effort',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreign.id,
          lookupFieldId: effortField!.id,
          linkFieldId: linkField.id,
        } as ILookupOptionsRo,
      } as IFieldRo);

      const numericFormulaField = await createField(table1Id, {
        name: 'lookup-plus-number',
        type: FieldType.Formula,
        options: {
          expression: `{${lookupField.id}} + {${numberFieldRo.id}}`,
        },
      });

      const numericFormulaMeta = await getField(table1Id, numericFormulaField.id);
      expect(numericFormulaMeta.dbFieldType).toBe(DbFieldType.Real);

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 5,
            },
          },
        ],
      });

      const recordId = records[0].id;

      await updateRecordByApi(
        table1Id,
        recordId,
        linkField.id,
        foreign.records.map((record) => ({ id: record.id }))
      );

      const updatedRecord = await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 9,
          },
        },
      });

      expect(updatedRecord.fields[numberFieldRo.name]).toEqual(9);
      expect(updatedRecord.fields[numericFormulaField.name]).not.toBeUndefined();
    } finally {
      if (foreign) {
        await permanentDeleteTable(baseId, foreign.id);
      }
    }
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
    await getRecord(table1Id, createdRecord.id);

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

  describe('binary operator coercion', () => {
    type OperatorTestContext = {
      tableId: string;
      numberField: typeof numberFieldRo;
      textField: typeof textFieldRo;
      userField: typeof userFieldRo;
      multiSelectField: typeof multiSelectFieldRo;
    };

    type ExtendedOperatorTestContext = OperatorTestContext & Record<string, unknown>;

    type OperatorCase = {
      name: string;
      setup?: (
        ctx: OperatorTestContext
      ) => Promise<Record<string, unknown>> | Record<string, unknown>;
      expression: (ctx: ExtendedOperatorTestContext) => string;
      initialFields: (ctx: ExtendedOperatorTestContext) => Record<string, unknown>;
      updatedFields: (ctx: ExtendedOperatorTestContext) => Record<string, unknown>;
      assertInitial: (value: unknown, ctx: ExtendedOperatorTestContext) => void;
      assertUpdated: (value: unknown, ctx: ExtendedOperatorTestContext) => void;
    };

    const sanitizeLabel = (label: string) => label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

    const operatorCases: OperatorCase[] = [
      {
        name: 'text equals numeric literal',
        expression: (ctx) => `{${ctx.textField.id}} = 0`,
        initialFields: (ctx) => ({
          [ctx.textField.name]: '0',
        }),
        updatedFields: (ctx) => ({
          [ctx.textField.name]: '5',
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(true);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(false);
        },
      },
      {
        name: 'text greater than numeric literal',
        expression: (ctx) => `{${ctx.textField.id}} > 2`,
        initialFields: (ctx) => ({
          [ctx.textField.name]: '10',
        }),
        updatedFields: (ctx) => ({
          [ctx.textField.name]: '1',
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(true);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(false);
        },
      },
      {
        name: 'number less than string literal',
        expression: (ctx) => `{${ctx.numberField.id}} < "10"`,
        initialFields: (ctx) => ({
          [ctx.numberField.name]: 3,
        }),
        updatedFields: (ctx) => ({
          [ctx.numberField.name]: 20,
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(true);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(false);
        },
      },
      {
        name: 'text minus numeric literal',
        expression: (ctx) => `{${ctx.textField.id}} - 2`,
        initialFields: (ctx) => ({
          [ctx.textField.name]: '5',
        }),
        updatedFields: (ctx) => ({
          [ctx.textField.name]: '1',
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(3);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(-1);
        },
      },
      {
        name: 'number plus numeric literal',
        expression: (ctx) => `{${ctx.numberField.id}} + 3`,
        initialFields: (ctx) => ({
          [ctx.numberField.name]: 4,
        }),
        updatedFields: (ctx) => ({
          [ctx.numberField.name]: 10,
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(7);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(13);
        },
      },
      {
        name: 'text divided by numeric literal',
        expression: (ctx) => `{${ctx.textField.id}} / 2`,
        initialFields: (ctx) => ({
          [ctx.textField.name]: '8',
        }),
        updatedFields: (ctx) => ({
          [ctx.textField.name]: '3',
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(4);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBeCloseTo(1.5, 9);
        },
      },
      {
        name: 'text multiplied by numeric literal',
        expression: (ctx) => `{${ctx.textField.id}} * 4`,
        initialFields: (ctx) => ({
          [ctx.textField.name]: '3',
        }),
        updatedFields: (ctx) => ({
          [ctx.textField.name]: '5',
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(12);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(20);
        },
      },
      {
        name: 'user equality against text',
        expression: (ctx) => `TEXT_ALL({${ctx.userField.id}}) = {${ctx.textField.id}}`,
        initialFields: (ctx) => ({
          [ctx.userField.name]: {
            id: globalThis.testConfig.userId,
            title: globalThis.testConfig.userName,
            email: globalThis.testConfig.email,
          },
          [ctx.textField.name]: globalThis.testConfig.userName,
        }),
        updatedFields: (ctx) => ({
          [ctx.userField.name]: {
            id: globalThis.testConfig.userId,
            title: globalThis.testConfig.userName,
            email: globalThis.testConfig.email,
          },
          [ctx.textField.name]: 'someone else',
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(true);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(false);
        },
      },
      {
        name: 'multi select equality against text',
        expression: (ctx) => `ARRAY_JOIN({${ctx.multiSelectField.id}}, '') = {${ctx.textField.id}}`,
        initialFields: (ctx) => ({
          [ctx.textField.name]: 'Alpha',
          [ctx.multiSelectField.name]: ['Alpha'],
        }),
        updatedFields: (ctx) => ({
          [ctx.textField.name]: 'Alpha',
          [ctx.multiSelectField.name]: ['Beta'],
        }),
        assertInitial: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(true);
        },
        assertUpdated: (value) => {
          expect(typeof value).toBe('boolean');
          expect(value).toBe(false);
        },
      },
    ];

    it.each(operatorCases)(
      'should evaluate $name without type coercion errors',
      async (testCase) => {
        const baseContext: OperatorTestContext = {
          tableId: table1Id,
          numberField: numberFieldRo,
          textField: textFieldRo,
          userField: userFieldRo,
          multiSelectField: multiSelectFieldRo,
        };

        const extraContext = (await testCase.setup?.(baseContext)) ?? {};
        const context = { ...baseContext, ...extraContext } as ExtendedOperatorTestContext;

        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: testCase.initialFields(context),
            },
          ],
        });
        const recordId = records[0].id;

        const formulaField = await createField(table1Id, {
          name: `binary-op-${sanitizeLabel(testCase.name)}`,
          type: FieldType.Formula,
          options: {
            expression: testCase.expression(context),
          },
        });

        const readFormulaValue = async () => {
          const record = await getRecord(table1Id, recordId);
          return record.data.fields[formulaField.name];
        };

        const initialValue = await readFormulaValue();
        testCase.assertInitial(initialValue, context);

        await updateRecord(table1Id, recordId, {
          fieldKeyType: FieldKeyType.Name,
          record: {
            fields: testCase.updatedFields(context),
          },
        });

        const updatedValue = await readFormulaValue();
        testCase.assertUpdated(updatedValue, context);
      }
    );
  });

  describe('boolean operator combinations', () => {
    it('should evaluate nested AND/OR across heterogeneous fields', async () => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 3,
              [textFieldRo.name]: 'Alpha announcement',
              [multiSelectFieldRo.name]: ['Alpha'],
              [userFieldRo.name]: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
                email: globalThis.testConfig.email,
              },
            },
          },
        ],
      });
      const recordId = records[0].id;

      const booleanField = await createField(table1Id, {
        name: 'boolean-nested-and-or',
        type: FieldType.Formula,
        options: {
          expression:
            `AND({${numberFieldRo.id}} > 0, ` +
            `OR({${textFieldRo.id}} != "", ARRAY_JOIN({${multiSelectFieldRo.id}}, '') = "Alpha"), ` +
            `LOWER({${userFieldRo.id}}) != "")`,
        },
      });

      const initialRecord = await getRecord(table1Id, recordId);
      expect(initialRecord.data.fields[booleanField.name]).toBe(true);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 0,
            [textFieldRo.name]: '',
            [multiSelectFieldRo.name]: null,
            [userFieldRo.name]: null,
          },
        },
      });

      const updatedRecord = await getRecord(table1Id, recordId);
      expect(updatedRecord.data.fields[booleanField.name]).toBe(false);
    });

    it('should evaluate OR with nested NOT and date comparison', async () => {
      const reviewDateField = await createField(table1Id, {
        name: 'review-date',
        type: FieldType.Date,
      } as IFieldRo);

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: -2,
              [textFieldRo.name]: '',
              [multiSelectFieldRo.name]: null,
              [reviewDateField.name]: '2025-05-01T00:00:00.000Z',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const numberBranchField = await createField(table1Id, {
        name: 'boolean-branch-number',
        type: FieldType.Formula,
        options: {
          expression: `{${numberFieldRo.id}} < 0`,
        },
      });

      const emptyStringBranchField = await createField(table1Id, {
        name: 'boolean-branch-empty-text',
        type: FieldType.Formula,
        options: {
          expression: `AND({${textFieldRo.id}} = "", NOT(ARRAY_JOIN({${multiSelectFieldRo.id}}, '') != ""))`,
        },
      });

      const dateBranchField = await createField(table1Id, {
        name: 'boolean-branch-date',
        type: FieldType.Formula,
        options: {
          expression: `AND(IS_BEFORE({${reviewDateField.id}}, '2026-01-01'), {${numberFieldRo.id}} <= 5)`,
        },
      });

      const complexBooleanField = await createField(table1Id, {
        name: 'boolean-nested-or',
        type: FieldType.Formula,
        options: {
          expression:
            `OR(` +
            `{${numberFieldRo.id}} < 0, ` +
            `AND({${textFieldRo.id}} = "", NOT(ARRAY_JOIN({${multiSelectFieldRo.id}}, '') != "")), ` +
            `AND(IS_BEFORE({${reviewDateField.id}}, '2026-01-01'), {${numberFieldRo.id}} <= 5)` +
            `)`,
        },
      });

      const initialRecord = await getRecord(table1Id, recordId);
      expect(initialRecord.data.fields[numberBranchField.name]).toBe(true);
      expect(initialRecord.data.fields[emptyStringBranchField.name]).toBe(true);
      expect(initialRecord.data.fields[dateBranchField.name]).toBe(true);
      expect(initialRecord.data.fields[complexBooleanField.name]).toBe(true);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 12,
            [textFieldRo.name]: 'Busy',
            [multiSelectFieldRo.name]: ['Alpha'],
            [reviewDateField.name]: '2026-02-01T00:00:00.000Z',
          },
        },
      });

      const updatedRecord = await getRecord(table1Id, recordId);
      expect(updatedRecord.data.fields[numberFieldRo.name]).toEqual(12);
      expect(updatedRecord.data.fields[textFieldRo.name]).toEqual('Busy');
      expect(updatedRecord.data.fields[multiSelectFieldRo.name]).toEqual(['Alpha']);
      expect(updatedRecord.data.fields[reviewDateField.name]).toEqual('2026-02-01T00:00:00.000Z');
      expect(updatedRecord.data.fields[numberBranchField.name]).toBe(false);
      expect(updatedRecord.data.fields[emptyStringBranchField.name]).toBe(false);
      expect(updatedRecord.data.fields[dateBranchField.name]).toBe(false);
      expect(updatedRecord.data.fields[complexBooleanField.name]).toBe(false);
    });
  });

  describe('LAST_MODIFIED_TIME field parameter', () => {
    // Helper to ensure time advances between operations (real time, not fake timers)
    // Note: vi.useFakeTimers() is incompatible with Keyv cache - it uses Date.now()
    // to check TTL, causing session data to be incorrectly deleted when fake time is set to the past.
    const waitForTimestamp = () => new Promise((resolve) => setTimeout(resolve, 100));

    it('should update when any referenced field changes', async () => {
      const multiTrackedFormulaField = await createField(table1Id, {
        name: 'multi-tracked-last-modified',
        type: FieldType.Formula,
        options: {
          expression: `LAST_MODIFIED_TIME({${textFieldRo.id}}, {${numberFieldRo.id}})`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [textFieldRo.name]: 'initial text',
              [numberFieldRo.name]: 1,
              [multiSelectFieldRo.name]: ['Alpha'],
            },
          },
        ],
      });
      const recordId = records[0].id;

      const initialRecord = await getRecord(table1Id, recordId);
      const initialFormulaValue = initialRecord.data.fields[multiTrackedFormulaField.name];
      expect(initialFormulaValue).toEqual(initialRecord.data.lastModifiedTime);

      // Wait for time to advance before untracked field update
      await waitForTimestamp();

      // Untracked field change should NOT update the formula
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [multiSelectFieldRo.name]: ['Beta'],
          },
        },
      });

      const afterUntrackedUpdate = await getRecord(table1Id, recordId);
      expect(afterUntrackedUpdate.data.lastModifiedTime).not.toEqual(
        initialRecord.data.lastModifiedTime
      );
      expect(afterUntrackedUpdate.data.fields[multiTrackedFormulaField.name]).toEqual(
        initialFormulaValue
      );

      // Wait for time to advance before tracked field update
      await waitForTimestamp();

      // Any tracked field change should update the formula
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 2,
          },
        },
      });

      const afterTrackedUpdate = await getRecord(table1Id, recordId);
      expect(afterTrackedUpdate.data.fields[multiTrackedFormulaField.name]).not.toEqual(
        initialFormulaValue
      );
      expect(afterTrackedUpdate.data.fields[multiTrackedFormulaField.name]).toEqual(
        afterTrackedUpdate.data.lastModifiedTime
      );
    });

    it('should update only when the referenced field changes', async () => {
      const lastModifiedFormulaField = await createField(table1Id, {
        name: 'tracked-last-modified',
        type: FieldType.Formula,
        options: {
          expression: `LAST_MODIFIED_TIME({${textFieldRo.id}})`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [textFieldRo.name]: 'initial text',
              [numberFieldRo.name]: 1,
            },
          },
        ],
      });
      const recordId = records[0].id;

      const initialRecord = await getRecord(table1Id, recordId);
      const initialFormulaValue = initialRecord.data.fields[lastModifiedFormulaField.name];
      expect(initialFormulaValue).toEqual(initialRecord.data.lastModifiedTime);

      // Wait for time to advance before unrelated field update
      await waitForTimestamp();

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 99,
          },
        },
      });

      const afterUnrelatedUpdate = await getRecord(table1Id, recordId);
      expect(afterUnrelatedUpdate.data.lastModifiedTime).not.toEqual(
        initialRecord.data.lastModifiedTime
      );
      expect(afterUnrelatedUpdate.data.fields[lastModifiedFormulaField.name]).toEqual(
        initialFormulaValue
      );

      // Wait for time to advance before tracked field update
      await waitForTimestamp();

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [textFieldRo.name]: 'updated text',
          },
        },
      });

      const afterTrackedUpdate = await getRecord(table1Id, recordId);
      expect(afterTrackedUpdate.data.fields[lastModifiedFormulaField.name]).not.toEqual(
        initialFormulaValue
      );
      expect(afterTrackedUpdate.data.fields[lastModifiedFormulaField.name]).toEqual(
        afterTrackedUpdate.data.lastModifiedTime
      );
    });

    it('should continue to work without passing the optional parameter', async () => {
      const defaultLastModifiedField = await createField(table1Id, {
        name: 'default-last-modified',
        type: FieldType.Formula,
        options: {
          expression: 'LAST_MODIFIED_TIME()',
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [textFieldRo.name]: 'plain text',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const initialRecord = await getRecord(table1Id, recordId);
      const initialFormulaValue = initialRecord.data.fields[defaultLastModifiedField.name];
      expect(initialFormulaValue).toEqual(initialRecord.data.lastModifiedTime);

      // Wait for time to advance before first update
      await waitForTimestamp();

      // Any field change should update the default tracking formula
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 123,
          },
        },
      });

      const afterAnyUpdate = await getRecord(table1Id, recordId);
      expect(afterAnyUpdate.data.fields[defaultLastModifiedField.name]).not.toEqual(
        initialFormulaValue
      );
      expect(afterAnyUpdate.data.fields[defaultLastModifiedField.name]).toEqual(
        afterAnyUpdate.data.lastModifiedTime
      );

      // Wait for time to advance before second update
      await waitForTimestamp();

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [textFieldRo.name]: 'changed text',
          },
        },
      });

      const afterDefaultUpdate = await getRecord(table1Id, recordId);
      expect(afterDefaultUpdate.data.fields[defaultLastModifiedField.name]).not.toEqual(
        afterAnyUpdate.data.fields[defaultLastModifiedField.name]
      );
      expect(afterDefaultUpdate.data.fields[defaultLastModifiedField.name]).toEqual(
        afterDefaultUpdate.data.lastModifiedTime
      );
    });

    it('should allow configuring Last Modified Time field to track specific fields only', async () => {
      const specificLmt = await createField(table1Id, {
        name: 'specific-lmt',
        type: FieldType.LastModifiedTime,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
            timeZone: 'UTC',
          },
          trackedFieldIds: [textFieldRo.id],
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [textFieldRo.name]: 'initial text',
              [numberFieldRo.name]: 1,
            },
          },
        ],
      });
      const recordId = records[0].id;

      const initialRecord = await getRecord(table1Id, recordId);
      const initialLmt = initialRecord.data.fields[specificLmt.name];
      expect(initialLmt).toEqual(initialRecord.data.lastModifiedTime);

      // Wait for time to advance before untracked field update
      await waitForTimestamp();

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 2,
          },
        },
      });

      const afterUntrackedUpdate = await getRecord(table1Id, recordId);
      expect(afterUntrackedUpdate.data.fields[specificLmt.name]).toEqual(initialLmt);

      // Wait for time to advance before tracked field update
      await waitForTimestamp();

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [textFieldRo.name]: 'updated text',
          },
        },
      });

      const afterTrackedUpdate = await getRecord(table1Id, recordId);
      expect(afterTrackedUpdate.data.fields[specificLmt.name]).not.toEqual(initialLmt);
      expect(afterTrackedUpdate.data.fields[specificLmt.name]).toEqual(
        afterTrackedUpdate.data.lastModifiedTime
      );
    });

    it('should reject non-field parameters', async () => {
      await createField(
        table1Id,
        {
          name: 'invalid-last-modified',
          type: FieldType.Formula,
          options: {
            expression: 'LAST_MODIFIED_TIME("literal param")',
          },
        },
        400
      );
    });
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

    it('should evaluate SUM with multiple arguments and conditional logic', async () => {
      const initialValue = 25;
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: initialValue,
              [textFieldRo.name]: 'numeric',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const formulaField = await createField(table1Id, {
        name: 'numeric-sum-if',
        type: FieldType.Formula,
        options: {
          expression: `SUM(IF({${numberFieldRo.id}} > 20, {${numberFieldRo.id}} - 20, {${numberFieldRo.id}} + 20), {${numberFieldRo.id}})`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const firstValue = recordAfterFormula.data.fields[formulaField.name];
      expect(firstValue).toBe(30);

      const updatedRecord = await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 10,
          },
        },
      });

      expect(updatedRecord.fields[formulaField.name]).toBe(40);
    });
  });

  describe('text formula functions', () => {
    const numericInput = 12.345;
    const textInput = 'Teable Rocks';
    const encodeUrlInput =
      'Been using Teable lately — honestly impressed @teableio \u00A0 Scattered work → AI-native system (for projects, CRM & marketing) in minutes 🚀 teable.ai';

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
        textValue: encodeUrlInput,
        expected: encodeURIComponent(encodeUrlInput),
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

    it('should encode line breaks in long text with ENCODE_URL_COMPONENT', async () => {
      const multilineInput = [
        'Been using Teable lately — honestly impressed @teableio',
        '\u00A0',
        'Scattered work → AI-native system (for projects, CRM & marketing) in minutes 🚀',
        'teable.ai',
      ].join('\n');

      const longTextField = await createField(table1Id, {
        name: 'long-text-encode-source',
        type: FieldType.LongText,
      });

      const formulaField = await createField(table1Id, {
        name: 'long-text-encode-result',
        type: FieldType.Formula,
        options: {
          expression: `ENCODE_URL_COMPONENT({${longTextField.id}})`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [longTextField.id]: multilineInput,
            },
          },
        ],
      });

      const record = await getRecord(table1Id, records[0].id);
      expect(record.data.fields[formulaField.name]).toBe(encodeURIComponent(multilineInput));
    });

    it('should keep date field time formatting when concatenated with text', async () => {
      const dateFormatting = {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Shanghai',
      };

      const dateField = await createField(table1Id, {
        name: 'formatted-date',
        type: FieldType.Date,
        options: {
          formatting: dateFormatting,
        },
      });

      const concatField = await createField(table1Id, {
        name: 'text-date-concat',
        type: FieldType.Formula,
        options: {
          expression: `{${textFieldRo.id}} & ' @ ' & {${dateField.id}}`,
        },
      });

      const prefix = 'Kickoff';
      const sourceIso = '2024-05-06T12:34:56.000Z';
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [textFieldRo.name]: prefix,
              [dateField.name]: sourceIso,
            },
          },
        ],
      });

      const record = await getRecord(table1Id, records[0].id);
      expect(record.data.fields[concatField.name]).toBe(`Kickoff @ 2024-05-06 12:34`);
    });

    it('should evaluate nested FIND formula on select field consistently', async () => {
      const assignmentField = await createField(table1Id, {
        name: '归属/对接',
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { id: 'choice-bp', name: 'BP' },
            { id: 'choice-tyh-1', name: 'TYH①' },
            { id: 'choice-lwl', name: 'LWL' },
            { id: 'choice-ella-1', name: 'Ella①' },
            { id: 'choice-shop-1', name: 'shop①' },
            { id: 'choice-lwl-plus', name: 'LWL+' },
            { id: 'choice-ella-1-plus', name: 'Ella①+' },
            { id: 'choice-shop-1-plus', name: 'shop①+' },
            { id: 'choice-zjq', name: 'ZJQ' },
            { id: 'choice-lk', name: 'LK' },
            { id: 'choice-allen-2', name: 'Allen②' },
            { id: 'choice-shop-2', name: 'shop②' },
            { id: 'choice-zjq-plus', name: 'ZJQ+' },
            { id: 'choice-allen-2-plus', name: 'Allen②+' },
            { id: 'choice-shop-2-plus', name: 'shop②+' },
            { id: 'choice-tyh-xf', name: 'TYH XF' },
            { id: 'choice-tyh', name: 'TYH' },
            { id: 'choice-xf', name: 'XF' },
            { id: 'choice-lucy-3', name: 'Lucy③' },
            { id: 'choice-shop-3', name: 'shop③' },
            { id: 'choice-tyh-plus', name: 'TYH+' },
            { id: 'choice-lucy-3-plus', name: 'Lucy③+' },
            { id: 'choice-shop-3-plus', name: 'shop③+' },
            { id: 'choice-jn', name: 'JN' },
            { id: 'choice-jenny-4', name: 'Jenny④' },
            { id: 'choice-jn-plus', name: 'JN+' },
            { id: 'choice-jenny-4-plus', name: 'Jenny④+' },
            { id: 'choice-other', name: 'Other' },
          ],
        } as ISelectFieldOptionsRo,
      });

      const expression = `IF(
  OR(
    FIND("BP", {${assignmentField.id}})
  ),
  "Young",
  IF(
    OR(
      FIND("TYH①", {${assignmentField.id}}),
      FIND("LWL", {${assignmentField.id}}),
      FIND("Ella①", {${assignmentField.id}}),
      FIND("shop①", {${assignmentField.id}}),
      FIND("LWL+", {${assignmentField.id}}),
      FIND("Ella①+", {${assignmentField.id}}),
      FIND("shop①+", {${assignmentField.id}})
    ),
    "Ella",
    IF(
      OR(
        FIND("ZJQ", {${assignmentField.id}}),
        FIND("LK", {${assignmentField.id}}),
        FIND("Allen②", {${assignmentField.id}}),
        FIND("shop②", {${assignmentField.id}}),
        FIND("ZJQ+", {${assignmentField.id}}),
        FIND("Allen②+", {${assignmentField.id}}),
        FIND("shop②+", {${assignmentField.id}})
      ),
      "Allen",
      IF(
        OR(
          FIND("TYH XF", {${assignmentField.id}}),
          FIND("TYH", {${assignmentField.id}}),
          FIND("XF", {${assignmentField.id}}),
          FIND("Lucy③", {${assignmentField.id}}),
          FIND("shop③", {${assignmentField.id}}),
          FIND("TYH+", {${assignmentField.id}}),
          FIND("Lucy③+", {${assignmentField.id}}),
          FIND("shop③+", {${assignmentField.id}})
        ),
        "Lucy",
        IF(
          OR(
            FIND("JN", {${assignmentField.id}}),
            FIND("Jenny④", {${assignmentField.id}}),
            FIND("JN+", {${assignmentField.id}}),
            FIND("Jenny④+", {${assignmentField.id}})
          ),
          "Jenny",
          "未识别"
        )
      )
    )
  )
)`;

      await convertField(table1Id, formulaFieldRo.id, {
        type: FieldType.Formula,
        options: {
          expression,
        },
      });

      const cases: Array<{ value: string; expected: string }> = [
        { value: 'BP', expected: 'Young' },
        { value: 'TYH', expected: 'Lucy' },
        { value: 'TYH XF', expected: 'Lucy' },
        { value: 'ZJQ+', expected: 'Allen' },
        { value: 'Jenny④', expected: 'Jenny' },
        { value: 'Other', expected: '未识别' },
      ];

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: cases.map(({ value }) => ({
          fields: {
            [assignmentField.name]: value,
          },
        })),
      });

      cases.forEach(({ expected }, index) => {
        expect(records[index].fields[formulaFieldRo.name]).toEqual(expected);
      });
    });

    it('should concatenate date and text fields with ampersand', async () => {
      const followDateField = await createField(table1Id, {
        name: 'follow date',
        type: FieldType.Date,
      } as IFieldRo);

      const followDateValue = '2025-10-24T00:00:00.000Z';
      const followContentValue = 'hello';

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: numericInput,
              [textFieldRo.name]: followContentValue,
              [followDateField.name]: followDateValue,
            },
          },
        ],
      });

      const recordId = records[0].id;

      const formulaField = await createField(table1Id, {
        name: 'follow summary',
        type: FieldType.Formula,
        options: {
          expression: `{${followDateField.id}} & "-" & {${textFieldRo.id}}`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const formulaValue = recordAfterFormula.data.fields[formulaField.name];
      expect(formulaValue).toBe('2025-10-24 00:00-hello');
    });

    it('should keep concatenated formula after updating referenced text field', async () => {
      const followDateField = await createField(table1Id, {
        name: 'follow date',
        type: FieldType.Date,
      } as IFieldRo);

      const followDateValue = '2025-10-24T00:00:00.000Z';
      const followContentValue = 'hello';

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: numericInput,
              [textFieldRo.name]: followContentValue,
              [followDateField.name]: followDateValue,
            },
          },
        ],
      });

      const recordId = records[0].id;

      const formulaField = await createField(table1Id, {
        name: 'follow summary',
        type: FieldType.Formula,
        options: {
          expression: `{${followDateField.id}} & "-" & {${textFieldRo.id}}`,
        },
      });

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [textFieldRo.name]: 'world',
          },
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const formulaValue = recordAfterFormula.data.fields[formulaField.name];
      expect(formulaValue).toBe('2025-10-24 00:00-world');
    });

    it('should flatten multi-value lookup single-select when concatenated', async () => {
      const foreign = await createTable(baseId, {
        name: 'lookup-single-select-foreign',
        fields: [
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { id: 'opt-a', name: 'Alpha' },
                { id: 'opt-b', name: 'Beta' },
              ],
            } as ISelectFieldOptionsRo,
          } as IFieldRo,
        ],
        records: [{ fields: { Status: 'Alpha' } }, { fields: { Status: 'Beta' } }],
      });

      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'lookup-single-select-host',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
            {
              name: 'Link',
              type: FieldType.Link,
              options: {
                foreignTableId: foreign.id,
                relationship: Relationship.ManyMany,
              } as ILinkFieldOptionsRo,
            } as IFieldRo,
          ],
          records: [{ fields: { Title: 'host row' } }],
        });

        const statusField = foreign.fields.find((f) => f.name === 'Status')!;
        const linkField = host.fields.find((f) => f.name === 'Link')!;

        const lookupField = await createField(host.id, {
          name: 'Status Lookup',
          type: FieldType.SingleSelect,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: statusField.id,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const formulaField = await createField(host.id, {
          name: 'Status Text',
          type: FieldType.Formula,
          options: {
            expression: `'Statuses: ' & {${lookupField.id}}`,
          },
        });

        const hostRecordId = host.records[0].id;

        await updateRecordByApi(
          host.id,
          hostRecordId,
          linkField.id,
          foreign.records.map((r) => ({ id: r.id }))
        );

        const record = await getRecord(host.id, hostRecordId);
        const lookupValue = record.data.fields[lookupField.name];
        expect(Array.isArray(lookupValue)).toBe(true);
        expect(record.data.fields[formulaField.name]).toBe('Statuses: Alpha, Beta');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should flatten link titles when concatenated', async () => {
      const foreign = await createTable(baseId, {
        name: 'concat-link-foreign',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'Link-A' } }, { fields: { Title: 'Link-B' } }],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'concat-link-host',
          fields: [
            { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
            {
              name: 'Links',
              type: FieldType.Link,
              options: {
                foreignTableId: foreign.id,
                relationship: Relationship.ManyMany,
              } as ILinkFieldOptionsRo,
            } as IFieldRo,
          ],
          records: [{ fields: { Title: 'host row' } }],
        });

        const linkField = host.fields.find((f) => f.name === 'Links')!;

        const formulaField = await createField(host.id, {
          name: 'Links Text',
          type: FieldType.Formula,
          options: {
            expression: `'Links: ' & {${linkField.id}}`,
          },
        });

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(
          host.id,
          hostRecordId,
          linkField.id,
          foreign.records.map((r) => ({ id: r.id }))
        );

        const record = await getRecord(host.id, hostRecordId);
        expect(record.data.fields[linkField.name]).toHaveLength(2);
        expect(record.data.fields[formulaField.name]).toBe('Links: Link-A, Link-B');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should normalize lookup link titles when used in formula', async () => {
      const assets = await createTable(baseId, {
        name: 'formula-lookup-link-assets',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'Alpha' } }, { fields: { Title: 'Beta' } }],
      });
      let owners: ITableFullVo | undefined;
      let requests: ITableFullVo | undefined;
      try {
        owners = await createTable(baseId, {
          name: 'formula-lookup-link-owners',
          fields: [{ name: 'Owner', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Owner: 'Owner A' } }],
        });

        const ownerAssetsLink = await createField(owners.id, {
          name: 'Assets',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: assets.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        await updateRecordByApi(
          owners.id,
          owners.records[0].id,
          ownerAssetsLink.id,
          assets.records.map((record) => ({ id: record.id }))
        );

        requests = await createTable(baseId, {
          name: 'formula-lookup-link-requests',
          fields: [{ name: 'Request', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Request: 'Req-1' } }],
        });

        const requestOwnerLink = await createField(requests.id, {
          name: 'Owner Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: owners.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        await updateRecordByApi(requests.id, requests.records[0].id, requestOwnerLink.id, {
          id: owners.records[0].id,
        });

        const ownerAssetsLookup = await createField(requests.id, {
          name: 'Owner Assets Lookup',
          type: FieldType.Link,
          isLookup: true,
          lookupOptions: {
            foreignTableId: owners.id,
            linkFieldId: requestOwnerLink.id,
            lookupFieldId: ownerAssetsLink.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const formulaField = await createField(requests.id, {
          name: 'Assets Text',
          type: FieldType.Formula,
          options: {
            expression: `'Assets: ' & {${ownerAssetsLookup.id}}`,
          },
        } as IFieldRo);

        const record = await getRecord(requests.id, requests.records[0].id);
        const formulaValue = record.data.fields[formulaField.name] as string;
        expect(formulaValue.startsWith('Assets: ')).toBe(true);
        expect(formulaValue).toContain('Alpha');
        expect(formulaValue).toContain('Beta');
        expect(formulaValue).not.toContain('"id"');
      } finally {
        if (requests) {
          await permanentDeleteTable(baseId, requests.id);
        }
        if (owners) {
          await permanentDeleteTable(baseId, owners.id);
        }
        await permanentDeleteTable(baseId, assets.id);
      }
    });

    it('should apply LEFT/RIGHT to lookup fields', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-left-foreign',
        fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Title: 'AlphaBeta' } }],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-lookup-left-host',
          fields: [
            { name: 'Note', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'Left Count', type: FieldType.Number } as IFieldRo,
            { name: 'Right Count', type: FieldType.Number } as IFieldRo,
          ],
        });

        const linkField = await createField(host.id, {
          name: 'Foreign Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const foreignTitleFieldId = foreign.fields.find((field) => field.name === 'Title')!.id;
        const lookupField = await createField(host.id, {
          name: 'Linked Title',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: foreignTitleFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const leftCountFieldId = host.fields.find((field) => field.name === 'Left Count')!.id;
        const rightCountFieldId = host.fields.find((field) => field.name === 'Right Count')!.id;

        const { records } = await createRecords(host.id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                Note: 'host note',
                'Left Count': 3,
                'Right Count': 4,
              },
            },
          ],
        });
        const hostRecordId = records[0].id;

        await updateRecordByApi(host.id, hostRecordId, linkField.id, {
          id: foreign.records[0].id,
        });

        const leftFormula = await createField(host.id, {
          name: 'lookup-left',
          type: FieldType.Formula,
          options: {
            expression: `LEFT({${lookupField.id}}, {${leftCountFieldId}})`,
          },
        });

        const rightFormula = await createField(host.id, {
          name: 'lookup-right',
          type: FieldType.Formula,
          options: {
            expression: `RIGHT({${lookupField.id}}, {${rightCountFieldId}})`,
          },
        });

        const recordAfterFormula = await getRecord(host.id, hostRecordId);
        expect(recordAfterFormula.data.fields[leftFormula.name]).toEqual('Alp');
        expect(recordAfterFormula.data.fields[rightFormula.name]).toEqual('Beta');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should treat lookup user value as truthy in IF', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-user-foreign',
        fields: [
          { name: 'Asset Title', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Owner',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          } as IFieldRo,
        ],
        records: [
          {
            fields: {
              'Asset Title': 'Laptop',
              Owner: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
                email: globalThis.testConfig.email,
              },
            },
          },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-lookup-user-host',
          fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Label: 'row 1' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Owner Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const ownerFieldId = foreign.fields.find((field) => field.name === 'Owner')!.id;

        const lookupField = await createField(host.id, {
          name: 'Owner Lookup',
          type: FieldType.User,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: ownerFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const statusField = await createField(host.id, {
          name: 'Owner Status',
          type: FieldType.Formula,
          options: {
            expression: `IF({${lookupField.id}}, '▶️ 在用', '✅ 闲置')`,
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;

        await updateRecordByApi(host.id, hostRecordId, linkField.id, { id: foreign.records[0].id });

        const linkedRecord = await getRecord(host.id, hostRecordId);
        expect(linkedRecord.data.fields[statusField.name]).toBe('▶️ 在用');

        await updateRecordByApi(host.id, hostRecordId, linkField.id, null);

        const clearedRecord = await getRecord(host.id, hostRecordId);
        expect(clearedRecord.data.fields[statusField.name]).toBe('✅ 闲置');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should treat empty conditional lookup user as falsy in IF', async () => {
      const foreign = await createTable(baseId, {
        name: 'conditional-lookup-user-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Owner',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Title: 'Unavailable asset',
              Status: 'Inactive',
              Owner: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
                email: globalThis.testConfig.email,
              },
            },
          },
        ],
      });

      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'conditional-lookup-user-host',
          fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Label: 'row 1' } }],
        });

        const ownerFieldId = foreign.fields.find((field) => field.name === 'Owner')!.id;
        const statusFieldId = foreign.fields.find((field) => field.name === 'Status')!.id;

        const lookupField = await createField(host.id, {
          name: 'Filtered Owner',
          type: FieldType.User,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: ownerFieldId,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: statusFieldId,
                  operator: 'is',
                  value: 'Active',
                },
              ],
            },
          } as ILookupOptionsRo,
        } as IFieldRo);

        const statusField = await createField(host.id, {
          name: 'Filtered Owner Status',
          type: FieldType.Formula,
          options: {
            expression: `IF({${lookupField.id}}, '▶️ 在用', '✅ 闲置')`,
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        const record = await getRecord(host.id, hostRecordId);
        const lookupValue = record.data.fields[lookupField.name];

        expect(
          lookupValue == null || (Array.isArray(lookupValue) && lookupValue.length === 0)
        ).toBe(true);
        expect(record.data.fields[statusField.name]).toBe('✅ 闲置');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should evaluate IF for multi-value lookup user when links are empty', async () => {
      const foreign = await createTable(baseId, {
        name: 'multi-lookup-user-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Owner',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Title: 'Shared asset',
              Owner: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
                email: globalThis.testConfig.email,
              },
            },
          },
        ],
      });

      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'multi-lookup-user-host',
          fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Label: 'row 1' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Owners Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const ownerFieldId = foreign.fields.find((field) => field.name === 'Owner')!.id;

        const lookupField = await createField(host.id, {
          name: 'Owners Lookup',
          type: FieldType.User,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: ownerFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const statusField = await createField(host.id, {
          name: 'Owners Status',
          type: FieldType.Formula,
          options: {
            expression: `IF({${lookupField.id}}, '▶️ 在用', '✅ 闲置')`,
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        const initialRecord = await getRecord(host.id, hostRecordId);
        expect(initialRecord.data.fields[lookupField.name]).toBeUndefined();
        expect(initialRecord.data.fields[statusField.name]).toBe('✅ 闲置');

        await updateRecordByApi(host.id, hostRecordId, linkField.id, [
          { id: foreign.records[0].id },
        ]);

        const linkedRecord = await getRecord(host.id, hostRecordId);
        expect(linkedRecord.data.fields[lookupField.name]).toHaveLength(1);
        expect(linkedRecord.data.fields[statusField.name]).toBe('▶️ 在用');

        await updateRecordByApi(host.id, hostRecordId, linkField.id, null);
        const clearedRecord = await getRecord(host.id, hostRecordId);
        const clearedLookup = clearedRecord.data.fields[lookupField.name];
        expect(
          clearedLookup == null || (Array.isArray(clearedLookup) && clearedLookup.length === 0)
        ).toBe(true);
        expect(clearedRecord.data.fields[statusField.name]).toBe('✅ 闲置');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should treat nested conditional lookup arrays as falsy in IF', async () => {
      const source = await createTable(baseId, {
        name: 'nested-lookup-source',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Owner',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          } as IFieldRo,
        ],
        records: [
          {
            fields: {
              Title: 'source',
              Status: 'Inactive',
              Owner: {
                id: globalThis.testConfig.userId,
                title: globalThis.testConfig.userName,
                email: globalThis.testConfig.email,
              },
            },
          },
        ],
      });

      let middle: ITableFullVo | undefined;
      let host: ITableFullVo | undefined;
      try {
        middle = await createTable(baseId, {
          name: 'nested-lookup-middle',
          fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Label: 'middle' } }],
        });

        const sourceOwnerFieldId = source.fields.find((field) => field.name === 'Owner')!.id;
        const sourceStatusFieldId = source.fields.find((field) => field.name === 'Status')!.id;

        const activeOwner = await createField(middle.id, {
          name: 'Active Owner',
          type: FieldType.User,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: source.id,
            lookupFieldId: sourceOwnerFieldId,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: sourceStatusFieldId,
                  operator: 'is',
                  value: 'Active',
                },
              ],
            },
          } as ILookupOptionsRo,
        } as IFieldRo);

        host = await createTable(baseId, {
          name: 'nested-lookup-host',
          fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Label: 'host' } }],
        });

        const middleLabelId = middle.fields.find((field) => field.name === 'Label')!.id;

        const nestedLookup = await createField(host.id, {
          name: 'Nested Active Owner',
          type: FieldType.User,
          isLookup: true,
          isConditionalLookup: true,
          lookupOptions: {
            foreignTableId: middle.id,
            lookupFieldId: activeOwner.id,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: middleLabelId,
                  operator: 'is',
                  value: 'middle',
                },
              ],
            },
          } as ILookupOptionsRo,
        } as IFieldRo);

        const statusField = await createField(host.id, {
          name: 'Nested Owner Status',
          type: FieldType.Formula,
          options: {
            expression: `IF({${nestedLookup.id}}, '▶️ 在用', '✅ 闲置')`,
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        const hostLabelFieldId = host.fields.find((field) => field.name === 'Label')!.id;
        await updateRecordByApi(host.id, hostRecordId, hostLabelFieldId, 'host');

        const record = await getRecord(host.id, hostRecordId);

        const nestedValue = record.data.fields[nestedLookup.name];

        expect(
          nestedValue == null || (Array.isArray(nestedValue) && nestedValue.length === 0)
        ).toBe(true);
        expect(record.data.fields[statusField.name]).toBe('✅ 闲置');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        if (middle) {
          await permanentDeleteTable(baseId, middle.id);
        }
        await permanentDeleteTable(baseId, source.id);
      }
    });

    it('should return user lookup with empty filter target and drive IF truthiness', async () => {
      const applicant = {
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
        email: globalThis.testConfig.email,
      };

      const foreign = await createTable(baseId, {
        name: 'lookup-filter-foreign',
        fields: [
          { name: 'Request No', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Return Date', type: FieldType.Date } as IFieldRo,
          {
            name: 'Applicant',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          } as IFieldRo,
        ],
        records: [
          {
            fields: {
              'Request No': 'AP-null',
              'Return Date': null,
              Applicant: applicant,
            },
          },
          {
            fields: {
              'Request No': 'AP-returned',
              'Return Date': '2024-10-20T00:00:00.000Z',
              Applicant: applicant,
            },
          },
        ],
      });

      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'lookup-filter-host',
          fields: [{ name: 'Asset', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Asset: 'A-null' } }, { fields: { Asset: 'A-returned' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Usage Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const returnFieldId = foreign.fields.find((f) => f.name === 'Return Date')!.id;
        const applicantFieldId = foreign.fields.find((f) => f.name === 'Applicant')!.id;

        const lookupField = await createField(host.id, {
          name: 'Active Applicant',
          type: FieldType.User,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: applicantFieldId,
            linkFieldId: linkField.id,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: returnFieldId,
                  operator: 'isEmpty',
                  value: null,
                },
              ],
            },
          } as ILookupOptionsRo,
        } as IFieldRo);

        const statusField = await createField(host.id, {
          name: 'Active Status',
          type: FieldType.Formula,
          options: {
            expression: `IF({${lookupField.id}}, '▶️ 在用', '✅ 闲置')`,
          },
        } as IFieldRo);

        const [assetNull, assetReturned] = host.records;

        await updateRecordByApi(host.id, assetNull.id, linkField.id, { id: foreign.records[0].id });
        await updateRecordByApi(host.id, assetReturned.id, linkField.id, {
          id: foreign.records[1].id,
        });

        const recordNull = await getRecord(host.id, assetNull.id);
        const recordReturned = await getRecord(host.id, assetReturned.id);

        expect(recordNull.data.fields[lookupField.name]).toMatchObject(applicant);
        expect(recordNull.data.fields[statusField.name]).toBe('▶️ 在用');

        expect(recordReturned.data.fields[lookupField.name]).toBeUndefined();
        expect(recordReturned.data.fields[statusField.name]).toBe('✅ 闲置');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should resolve filtered lookup user only when return link is empty', async () => {
      const applicant = {
        id: globalThis.testConfig.userId,
        title: globalThis.testConfig.userName,
        email: globalThis.testConfig.email,
      };

      const returnTable = await createTable(baseId, {
        name: 'return-records',
        fields: [{ name: 'Return ID', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { 'Return ID': 'RB-001' } }, { fields: { 'Return ID': 'RB-002' } }],
      });

      const usageTable = await createTable(baseId, {
        name: 'usage-records',
        fields: [
          { name: 'Request No', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Applicant',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          } as IFieldRo,
          {
            name: 'Return Link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: returnTable.id,
            } as ILinkFieldOptionsRo,
          } as IFieldRo,
        ],
      });

      const returnLinkFieldId = usageTable.fields.find((f) => f.name === 'Return Link')!.id;
      const applicantFieldId = usageTable.fields.find((f) => f.name === 'Applicant')!.id;

      const { records: usageRecords } = await createRecords(usageTable.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              'Request No': 'AP-returned',
              Applicant: applicant,
            },
          },
          {
            fields: {
              'Request No': 'AP-active',
              Applicant: applicant,
            },
          },
        ],
      });

      await updateRecordByApi(usageTable.id, usageRecords[0].id, returnLinkFieldId, {
        id: returnTable.records[0].id,
      });
      await updateRecordByApi(usageTable.id, usageRecords[1].id, returnLinkFieldId, null);

      let assetTable: ITableFullVo | undefined;
      try {
        assetTable = await createTable(baseId, {
          name: 'asset-info',
          fields: [
            { name: 'Asset Code', type: FieldType.SingleLineText } as IFieldRo,
            {
              name: 'Usage Link',
              type: FieldType.Link,
              options: {
                relationship: Relationship.ManyOne,
                foreignTableId: usageTable.id,
              } as ILinkFieldOptionsRo,
            } as IFieldRo,
          ],
          records: [
            { fields: { 'Asset Code': 'A-returned' } },
            { fields: { 'Asset Code': 'A-active' } },
          ],
        });

        const usageLinkFieldId = assetTable.fields.find((f) => f.name === 'Usage Link')!.id;

        const lookupField = await createField(assetTable.id, {
          name: 'Filtered User',
          type: FieldType.User,
          isLookup: true,
          lookupOptions: {
            foreignTableId: usageTable.id,
            lookupFieldId: applicantFieldId,
            linkFieldId: usageLinkFieldId,
            filter: {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: returnLinkFieldId,
                  operator: 'isEmpty',
                  value: null,
                },
              ],
            },
          } as ILookupOptionsRo,
        } as IFieldRo);

        await updateRecordByApi(assetTable.id, assetTable.records[0].id, usageLinkFieldId, {
          id: usageRecords[0].id,
        });
        await updateRecordByApi(assetTable.id, assetTable.records[1].id, usageLinkFieldId, {
          id: usageRecords[1].id,
        });

        const returnedAsset = await getRecord(assetTable.id, assetTable.records[0].id);
        const activeAsset = await getRecord(assetTable.id, assetTable.records[1].id);

        expect(returnedAsset.data.fields[lookupField.name]).toBeUndefined();
        expect(activeAsset.data.fields[lookupField.name]).toMatchObject(applicant);
      } finally {
        if (assetTable) {
          await permanentDeleteTable(baseId, assetTable.id);
        }
        await permanentDeleteTable(baseId, usageTable.id);
        await permanentDeleteTable(baseId, returnTable.id);
      }
    });

    it('should flatten multi-value lookup formulas returning scalar text', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-flatten-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Scheduled', type: FieldType.Date } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Task A', Scheduled: '2025-10-31T08:10:24.894Z' } },
          { fields: { Title: 'Task B', Scheduled: '2025-11-05T10:00:00.000Z' } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        const scheduledFieldId = foreign.fields.find((field) => field.name === 'Scheduled')!.id;
        const taggedFormula = await createField(foreign.id, {
          name: 'Schedule Tag',
          type: FieldType.Formula,
          options: {
            expression: `CONCATENATE(DATETIME_FORMAT({${scheduledFieldId}}, 'YYYY-MM-DD'), "-tag")`,
          },
        });

        host = await createTable(baseId, {
          name: 'formula-lookup-flatten-host',
          fields: [{ name: 'Project', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Project: 'Main' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Related Tasks',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const lookupField = await createField(host.id, {
          name: 'Tagged Schedules',
          type: FieldType.Formula,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: taggedFormula.id,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(
          host.id,
          hostRecordId,
          linkField.id,
          foreign.records.map((record) => ({ id: record.id }))
        );

        const updatedRecord = await getRecord(host.id, hostRecordId);
        expect(updatedRecord.data.fields[lookupField.name]).toEqual([
          '2025-10-31-tag',
          '2025-11-05-tag',
        ]);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should format multi-value lookup dates with DATETIME_FORMAT', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-datetime-format-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Milestone Date', type: FieldType.Date } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', 'Milestone Date': '2023-10-11T16:00:00.000Z' } },
          { fields: { Title: 'Beta', 'Milestone Date': '2023-10-11T16:00:00.000Z' } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-lookup-datetime-format-host',
          fields: [{ name: 'Project', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Project: 'Lookup timeline' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Related Milestones',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const milestoneDateFieldId = foreign.fields.find(
          (field) => field.name === 'Milestone Date'
        )!.id;

        const lookupField = await createField(host.id, {
          name: 'Milestone Dates',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: milestoneDateFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            },
          },
        } as IFieldRo);

        const formattedField = await createField(host.id, {
          name: 'Milestone Day',
          type: FieldType.Formula,
          options: {
            expression: `DATETIME_FORMAT({${lookupField.id}}, 'DD')`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const dayNumberField = await createField(host.id, {
          name: 'Milestone Day Number',
          type: FieldType.Formula,
          options: {
            expression: `DAY({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const dateStrField = await createField(host.id, {
          name: 'Milestone DateStr',
          type: FieldType.Formula,
          options: {
            expression: `DATESTR({${lookupField.id}})`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const timeStrField = await createField(host.id, {
          name: 'Milestone TimeStr',
          type: FieldType.Formula,
          options: {
            expression: `TIMESTR({${lookupField.id}})`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const monthField = await createField(host.id, {
          name: 'Milestone Month',
          type: FieldType.Formula,
          options: {
            expression: `MONTH({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const yearField = await createField(host.id, {
          name: 'Milestone Year',
          type: FieldType.Formula,
          options: {
            expression: `YEAR({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const weekDayField = await createField(host.id, {
          name: 'Milestone Weekday',
          type: FieldType.Formula,
          options: {
            expression: `WEEKDAY({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const weekNumField = await createField(host.id, {
          name: 'Milestone Weeknum',
          type: FieldType.Formula,
          options: {
            expression: `WEEKNUM({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const hourField = await createField(host.id, {
          name: 'Milestone Hour',
          type: FieldType.Formula,
          options: {
            expression: `HOUR({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const minuteField = await createField(host.id, {
          name: 'Milestone Minute',
          type: FieldType.Formula,
          options: {
            expression: `MINUTE({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const secondField = await createField(host.id, {
          name: 'Milestone Second',
          type: FieldType.Formula,
          options: {
            expression: `SECOND({${lookupField.id}}) & ''`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(
          host.id,
          hostRecordId,
          linkField.id,
          foreign.records.map((record) => ({ id: record.id }))
        );

        const updatedRecord = await getRecord(host.id, hostRecordId);
        expect(updatedRecord.data.fields[formattedField.name]).toEqual('12, 12');
        expect(updatedRecord.data.fields[dayNumberField.name]).toEqual('12, 12');
        expect(updatedRecord.data.fields[dateStrField.name]).toEqual('2023-10-12, 2023-10-12');
        expect(updatedRecord.data.fields[timeStrField.name]).toEqual('00:00:00, 00:00:00');
        expect(updatedRecord.data.fields[monthField.name]).toEqual('10, 10');
        expect(updatedRecord.data.fields[yearField.name]).toEqual('2023, 2023');
        expect(updatedRecord.data.fields[weekDayField.name]).toEqual('4, 4');
        expect(updatedRecord.data.fields[weekNumField.name]).toEqual('41, 41');
        expect(updatedRecord.data.fields[hourField.name]).toEqual('0, 0');
        expect(updatedRecord.data.fields[minuteField.name]).toEqual('0, 0');
        expect(updatedRecord.data.fields[secondField.name]).toEqual('0, 0');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('applies timezone-aware formatting before slicing datetime values', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-datetime-slice-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Approval Date',
            type: FieldType.Date,
            options: {
              formatting: {
                date: DateFormattingPreset.ISO,
                time: TimeFormatting.None,
                timeZone: 'Asia/Shanghai',
              },
            },
          } as IFieldRo,
        ],
        records: [{ fields: { Title: 'Milestone', 'Approval Date': '2023-02-25T16:00:00.000Z' } }],
      });
      let host: ITableFullVo | undefined;
      try {
        const approvalFieldId = foreign.fields.find((field) => field.name === 'Approval Date')!.id;

        const directLeftField = await createField(foreign.id, {
          name: 'Approval Left',
          type: FieldType.Formula,
          options: {
            expression: `LEFT({${approvalFieldId}}, 4)`,
            timeZone: 'Asia/Shanghai',
          },
        });

        const directMidField = await createField(foreign.id, {
          name: 'Approval Mid',
          type: FieldType.Formula,
          options: {
            expression: `MID({${approvalFieldId}}, 6, 2)`,
            timeZone: 'Asia/Shanghai',
          },
        });

        const directSearchField = await createField(foreign.id, {
          name: 'Approval Search',
          type: FieldType.Formula,
          options: {
            expression: `SEARCH("02", {${approvalFieldId}})`,
            timeZone: 'Asia/Shanghai',
          },
        });

        const directSliceField = await createField(foreign.id, {
          name: 'Approval Day Tail',
          type: FieldType.Formula,
          options: {
            expression: `RIGHT({${approvalFieldId}}, 2)`,
            timeZone: 'Asia/Shanghai',
          },
        });

        const directRecord = await getRecord(foreign.id, foreign.records[0].id);
        expect(directRecord.data.fields[directSliceField.name]).toBe('26');
        expect(directRecord.data.fields[directLeftField.name]).toBe('2023');
        expect(directRecord.data.fields[directMidField.name]).toBe('02');
        expect(directRecord.data.fields[directSearchField.name]).toBeGreaterThan(0);

        host = await createTable(baseId, {
          name: 'formula-datetime-slice-host',
          fields: [{ name: 'Project', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Project: 'Lookup slice' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Related Approval',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const lookupField = await createField(host.id, {
          name: 'Approval Lookup',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: approvalFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            },
          },
        } as IFieldRo);

        const lookupLeftField = await createField(host.id, {
          name: 'Approval Lookup Left',
          type: FieldType.Formula,
          options: {
            expression: `LEFT({${lookupField.id}}, 4)`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const lookupMidField = await createField(host.id, {
          name: 'Approval Lookup Mid',
          type: FieldType.Formula,
          options: {
            expression: `MID({${lookupField.id}}, 6, 2)`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const lookupSearchField = await createField(host.id, {
          name: 'Approval Lookup Search',
          type: FieldType.Formula,
          options: {
            expression: `SEARCH("02", {${lookupField.id}})`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const lookupSliceField = await createField(host.id, {
          name: 'Approval Lookup Day Tail',
          type: FieldType.Formula,
          options: {
            expression: `RIGHT({${lookupField.id}}, 2)`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(host.id, hostRecordId, linkField.id, [
          { id: foreign.records[0].id },
        ]);

        const lookupRecord = await getRecord(host.id, hostRecordId);
        expect(lookupRecord.data.fields[lookupSliceField.name]).toBe('26');
        expect(lookupRecord.data.fields[lookupLeftField.name]).toBe('2023');
        expect(lookupRecord.data.fields[lookupMidField.name]).toBe('02');
        expect(lookupRecord.data.fields[lookupSearchField.name]).toBeGreaterThan(0);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('applies timezone-aware slicing on multi-value lookup datetimes', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-datetime-slice-multi-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          {
            name: 'Milestone',
            type: FieldType.Date,
            options: {
              formatting: {
                date: DateFormattingPreset.ISO,
                time: TimeFormatting.None,
                timeZone: 'Asia/Shanghai',
              },
            },
          } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'A', Milestone: '2023-02-25T16:00:00.000Z' } },
          { fields: { Title: 'B', Milestone: '2023-03-01T16:00:00.000Z' } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        const milestoneFieldId = foreign.fields.find((field) => field.name === 'Milestone')!.id;

        host = await createTable(baseId, {
          name: 'formula-datetime-slice-multi-host',
          fields: [{ name: 'Project', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Project: 'Lookup slice multi' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Related Milestones',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const lookupField = await createField(host.id, {
          name: 'Milestone Dates Lookup',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: milestoneFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            },
          },
        } as IFieldRo);

        const sliceField = await createField(host.id, {
          name: 'Milestone Slice',
          type: FieldType.Formula,
          options: {
            expression: `MID({${lookupField.id}}, 3, 4)`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(host.id, hostRecordId, linkField.id, [
          { id: foreign.records[0].id },
          { id: foreign.records[1].id },
        ]);

        const lookupRecord = await getRecord(host.id, hostRecordId);
        expect(lookupRecord.data.fields[sliceField.name]).toBe('23-0');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should format multi-value lookup numbers with VALUE', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-value-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Budget', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Phase A', Budget: 1200.45 } },
          { fields: { Title: 'Phase B', Budget: 3400.51 } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-lookup-value-host',
          fields: [{ name: 'Project', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Project: 'Budget run' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Related Budgets',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const budgetFieldId = foreign.fields.find((field) => field.name === 'Budget')!.id;

        const lookupField = await createField(host.id, {
          name: 'Budget Lookup',
          type: FieldType.Number,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: budgetFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const formattedField = await createField(host.id, {
          name: 'Budget Value Formula',
          type: FieldType.Formula,
          options: {
            expression: `VALUE({${lookupField.id}}) & ''`,
          },
        } as IFieldRo);

        const roundedField = await createField(host.id, {
          name: 'Budget Rounded',
          type: FieldType.Formula,
          options: {
            expression: `ROUND({${lookupField.id}}, 0) & ''`,
          },
        } as IFieldRo);

        const roundUpField = await createField(host.id, {
          name: 'Budget RoundUp',
          type: FieldType.Formula,
          options: {
            expression: `ROUNDUP({${lookupField.id}}, 0) & ''`,
          },
        } as IFieldRo);

        const roundDownField = await createField(host.id, {
          name: 'Budget RoundDown',
          type: FieldType.Formula,
          options: {
            expression: `ROUNDDOWN({${lookupField.id}}, 0) & ''`,
          },
        } as IFieldRo);

        const floorField = await createField(host.id, {
          name: 'Budget Floor',
          type: FieldType.Formula,
          options: {
            expression: `FLOOR({${lookupField.id}}) & ''`,
          },
        } as IFieldRo);

        const ceilingField = await createField(host.id, {
          name: 'Budget Ceiling',
          type: FieldType.Formula,
          options: {
            expression: `CEILING({${lookupField.id}}) & ''`,
          },
        } as IFieldRo);

        const intField = await createField(host.id, {
          name: 'Budget Int',
          type: FieldType.Formula,
          options: {
            expression: `INT({${lookupField.id}}) & ''`,
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(
          host.id,
          hostRecordId,
          linkField.id,
          foreign.records.map((record) => ({ id: record.id }))
        );

        const updatedRecord = await getRecord(host.id, hostRecordId);
        expect(updatedRecord.data.fields[formattedField.name]).toEqual('1200.45, 3400.51');
        expect(updatedRecord.data.fields[roundedField.name]).toEqual('1200, 3401');
        expect(updatedRecord.data.fields[roundUpField.name]).toEqual('1201, 3401');
        expect(updatedRecord.data.fields[roundDownField.name]).toEqual('1200, 3400');
        expect(updatedRecord.data.fields[floorField.name]).toEqual('1200, 3400');
        expect(updatedRecord.data.fields[ceilingField.name]).toEqual('1201, 3401');
        expect(updatedRecord.data.fields[intField.name]).toEqual('1200, 3400');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should evaluate formulas referencing lookup formulas', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-formula-foreign',
        fields: [
          { name: 'First Name', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Last Name', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          {
            fields: {
              'First Name': 'Ada',
              'Last Name': 'Lovelace',
            },
          },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-lookup-formula-host',
          fields: [{ name: 'Note', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Note: 'host note' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Linked Person',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const firstNameFieldId = foreign.fields.find((field) => field.name === 'First Name')!.id;
        const lastNameFieldId = foreign.fields.find((field) => field.name === 'Last Name')!.id;
        const fullNameFormula = await createField(foreign.id, {
          name: 'Full Name',
          type: FieldType.Formula,
          options: {
            expression: `{${firstNameFieldId}} & "-" & {${lastNameFieldId}}`,
          },
        } as IFieldRo);

        const lookupField = await createField(host.id, {
          name: 'Full Name Lookup',
          type: FieldType.Formula,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: fullNameFormula.id,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(host.id, hostRecordId, linkField.id, {
          id: foreign.records[0].id,
        });

        const hostFormula = await createField(host.id, {
          name: 'Greeting',
          type: FieldType.Formula,
          options: {
            expression: `CONCATENATE({${lookupField.id}}, "!")`,
          },
        } as IFieldRo);

        const recordAfter = await getRecord(host.id, hostRecordId);
        expect(recordAfter.data.fields[lookupField.name]).toBe('Ada-Lovelace');
        expect(recordAfter.data.fields[hostFormula.name]).toBe('Ada-Lovelace!');
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should calculate numeric formulas using lookup fields', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-lookup-numeric-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Total Units', type: FieldType.Number } as IFieldRo,
          { name: 'Completed Units', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Alpha', 'Total Units': 12, 'Completed Units': 5 } },
          { fields: { Title: 'Beta', 'Total Units': 20, 'Completed Units': 3 } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-lookup-numeric-host',
          fields: [{ name: 'Note', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Note: 'host note' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Numeric Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const totalFieldId = foreign.fields.find((field) => field.name === 'Total Units')!.id;
        const completedFieldId = foreign.fields.find(
          (field) => field.name === 'Completed Units'
        )!.id;

        const totalLookup = await createField(host.id, {
          name: 'Total Units Lookup',
          type: FieldType.Number,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: totalFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const completedLookup = await createField(host.id, {
          name: 'Completed Units Lookup',
          type: FieldType.Number,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: completedFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(host.id, hostRecordId, linkField.id, {
          id: foreign.records[0].id,
        });

        const formulaField = await createField(host.id, {
          name: 'Remaining Units',
          type: FieldType.Formula,
          options: {
            expression: `{${totalLookup.id}} - {${completedLookup.id}}`,
          },
        });

        const recordAfterFormula = await getRecord(host.id, hostRecordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        expect(typeof value).toBe('number');
        expect(value).toBe(7);
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('should format lookup-to-link titles with DATETIME_FORMAT results', async () => {
      const detailTitle = 'Example Asset';
      const dateValue = '2025-03-14T00:00:00.000Z';
      const detailTable = await createTable(baseId, {
        name: 'Lookup Details',
        fields: [{ name: 'Detail Title', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { 'Detail Title': detailTitle } }],
      });
      let platformTable: ITableFullVo | undefined;
      let summaryTable: ITableFullVo | undefined;
      try {
        platformTable = await createTable(baseId, {
          name: 'Link Layer',
          fields: [{ name: 'Link Name', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { 'Link Name': 'Platform Alpha' } }],
        });
        summaryTable = await createTable(baseId, {
          name: 'Aggregated Reports',
          fields: [{ name: 'Report Date', type: FieldType.Date } as IFieldRo],
          records: [{ fields: { 'Report Date': dateValue } }],
        });

        const platformToDetail = await createField(platformTable.id, {
          name: 'Linked Detail',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: detailTable.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);
        const reportToPlatform = await createField(summaryTable.id, {
          name: 'Linked Platform',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: platformTable.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const lookupField = await createField(summaryTable.id, {
          name: 'Platform Detail Lookup',
          type: FieldType.Link,
          isLookup: true,
          lookupOptions: {
            foreignTableId: platformTable.id,
            linkFieldId: reportToPlatform.id,
            lookupFieldId: platformToDetail.id,
          } as ILookupOptionsRo,
        } as IFieldRo);
        const dateFieldId = summaryTable.fields.find((f) => f.name === 'Report Date')!.id;
        const labelField = await createField(summaryTable.id, {
          name: 'Label',
          type: FieldType.Formula,
          options: {
            expression: `{${lookupField.id}} & '-' & DATETIME_FORMAT({${dateFieldId}}, "YY-MM-DD")`,
          },
        } as IFieldRo);

        await updateRecordByApi(
          platformTable.id,
          platformTable.records[0].id,
          platformToDetail.id,
          [{ id: detailTable.records[0].id }]
        );
        await updateRecordByApi(summaryTable.id, summaryTable.records[0].id, reportToPlatform.id, {
          id: platformTable.records[0].id,
        });

        const { data: record } = await getRecord(summaryTable.id, summaryTable.records[0].id);
        const lookupValue = record.fields[lookupField.name] as Array<{ title: string }>;
        expect(lookupValue).toHaveLength(1);
        expect(lookupValue?.[0]?.title).toBe(detailTitle);
        expect(record.fields[labelField.name]).toBe('Example Asset-25-03-14');
      } finally {
        if (summaryTable) {
          await permanentDeleteTable(baseId, summaryTable.id);
        }
        if (platformTable) {
          await permanentDeleteTable(baseId, platformTable.id);
        }
        await permanentDeleteTable(baseId, detailTable.id);
      }
    });

    it('should keep concatenated formula after updating referenced date field', async () => {
      const followDateField = await createField(table1Id, {
        name: 'follow date',
        type: FieldType.Date,
      } as IFieldRo);

      const followDateValue = '2025-10-24T00:00:00.000Z';
      const followContentValue = 'hello';

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: numericInput,
              [textFieldRo.name]: followContentValue,
              [followDateField.name]: followDateValue,
            },
          },
        ],
      });

      const recordId = records[0].id;

      const formulaField = await createField(table1Id, {
        name: 'follow summary',
        type: FieldType.Formula,
        options: {
          expression: `{${followDateField.id}} & "-" & {${textFieldRo.id}}`,
        },
      });

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [followDateField.name]: '2025-10-26T00:00:00.000Z',
          },
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const formulaValue = recordAfterFormula.data.fields[formulaField.name];
      expect(formulaValue).toBe('2025-10-26 00:00-hello');
    });
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

    it('should populate RECORD_ID formula for newly created records', async () => {
      const formulaField = await createField(table1Id, {
        name: 'logic-record-id-create',
        type: FieldType.Formula,
        options: {
          expression: 'RECORD_ID()',
        },
      });

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

      const createdRecord = records[0];
      expect(typeof createdRecord.id).toBe('string');
      expect(createdRecord.id.length).toBeGreaterThan(0);

      const formulaValue = createdRecord.fields?.[formulaField.name] as string | null;
      expect(formulaValue).toBe(createdRecord.id);

      const recordAfterCreate = await getRecord(table1Id, createdRecord.id);
      const persistedValue = recordAfterCreate.data.fields?.[formulaField.name] as string | null;
      expect(persistedValue).toBe(createdRecord.id);
    });

    it('should normalize truthiness for non-boolean logical inputs', async () => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 5,
              [textFieldRo.name]: 'value',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const [andField, orField, notField] = await Promise.all([
        createField(table1Id, {
          name: 'logical-truthiness-and',
          type: FieldType.Formula,
          options: {
            expression: `AND({${numberFieldRo.id}}, {${textFieldRo.id}})`,
          },
        }),
        createField(table1Id, {
          name: 'logical-truthiness-or',
          type: FieldType.Formula,
          options: {
            expression: `OR({${numberFieldRo.id}}, {${textFieldRo.id}})`,
          },
        }),
        createField(table1Id, {
          name: 'logical-truthiness-not',
          type: FieldType.Formula,
          options: {
            expression: `NOT({${numberFieldRo.id}})`,
          },
        }),
      ]);

      const readValues = async () => {
        const record = await getRecord(table1Id, recordId);
        return {
          and: record.data.fields[andField.name],
          or: record.data.fields[orField.name],
          not: record.data.fields[notField.name],
        } as { and: boolean; or: boolean; not: boolean };
      };

      let values = await readValues();
      expect(values.and).toBe(true);
      expect(values.or).toBe(true);
      expect(values.not).toBe(false);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: 0,
            [textFieldRo.name]: '',
          },
        },
      });

      values = await readValues();
      expect(values.and).toBe(false);
      expect(values.or).toBe(false);
      expect(values.not).toBe(true);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberFieldRo.name]: null,
            [textFieldRo.name]: 'fallback',
          },
        },
      });

      values = await readValues();
      expect(values.and).toBe(false);
      expect(values.or).toBe(true);
      expect(values.not).toBe(true);
    });

    it('should not persist logical coercion AND formula as generated column', async () => {
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 3,
              [textFieldRo.name]: 'non-empty',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const formulaField = await createField(table1Id, {
        name: 'logical-coercion-and-persisted',
        type: FieldType.Formula,
        options: {
          expression: `AND({${numberFieldRo.id}}, {${textFieldRo.id}})`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const value = recordAfterFormula.data.fields[formulaField.name];
      expect(typeof value).toBe('boolean');
      expect(value).toBe(true);

      const refreshed = await getField(table1Id, formulaField.id);
      const rawMeta = refreshed.meta as unknown;
      let persistedAsGeneratedColumn: boolean | undefined;
      if (typeof rawMeta === 'string') {
        persistedAsGeneratedColumn = (
          JSON.parse(rawMeta) as { persistedAsGeneratedColumn?: boolean }
        ).persistedAsGeneratedColumn;
      } else if (rawMeta && typeof rawMeta === 'object') {
        persistedAsGeneratedColumn = (rawMeta as { persistedAsGeneratedColumn?: boolean })
          .persistedAsGeneratedColumn;
      }
      expect(persistedAsGeneratedColumn).not.toBe(true);
    });

    it('should evaluate logical formulas referencing boolean checkbox fields', async () => {
      const checkboxField = await createField(table1Id, {
        name: 'logical-checkbox',
        type: FieldType.Checkbox,
        options: {},
      });

      const booleanFormulaField = await createField(table1Id, {
        name: 'logical-checkbox-formula',
        type: FieldType.Formula,
        options: {
          expression: `AND({${checkboxField.id}}, {${numberFieldRo.id}} > 0)`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [checkboxField.name]: true,
              [numberFieldRo.name]: 5,
              [textFieldRo.name]: 'flagged',
            },
          },
        ],
      });

      const recordId = records[0].id;
      const initialValue = records[0].fields[booleanFormulaField.name];
      expect(typeof initialValue).toBe('boolean');
      expect(initialValue).toBe(true);

      const uncheckedRecord = await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [checkboxField.name]: null,
          },
        },
      });
      expect(uncheckedRecord.fields[booleanFormulaField.name]).toBe(false);

      const recheckedRecord = await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [checkboxField.name]: true,
          },
        },
      });
      expect(recheckedRecord.fields[booleanFormulaField.name]).toBe(true);
    });

    it('should treat numeric IF fallbacks with blank branches as nulls', async () => {
      const numericCondition = await createField(table1Id, {
        name: 'numeric-condition',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });

      const numericSubtrahend = await createField(table1Id, {
        name: 'numeric-subtrahend',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });

      const blankCondition = await createField(table1Id, {
        name: 'blank-condition',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });

      const fallbackNumeric = await createField(table1Id, {
        name: 'fallback-numeric',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });

      const formulaField = await createField(table1Id, {
        name: 'numeric-if-fallback',
        type: FieldType.Formula,
        options: {
          expression:
            `IF({${numericCondition.id}} > 0, {${numericCondition.id}} - {${numericSubtrahend.id}}, ` +
            `IF({${blankCondition.id}} > 0, '', {${fallbackNumeric.id}}))`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numericCondition.name]: 10,
              [numericSubtrahend.name]: 3,
              [blankCondition.name]: 0,
              [fallbackNumeric.name]: 5,
            },
          },
        ],
      });

      const recordId = records[0].id;

      const readFormulaValue = async () => {
        const record = await getRecord(table1Id, recordId);
        return record.data.fields[formulaField.name] as number | null;
      };

      // Numeric branch should compute the difference.
      let value = await readFormulaValue();
      expect(value).toBeCloseTo(7);

      // Trigger the blank branch – it should evaluate to null rather than ''.
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numericCondition.name]: 0,
            [blankCondition.name]: 8,
          },
        },
      });

      value = await readFormulaValue();
      expect(value ?? null).toBeNull();

      // Finally, the nested fallback should surface the numeric value unchanged.
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [blankCondition.name]: 0,
            [fallbackNumeric.name]: -4,
          },
        },
      });

      value = await readFormulaValue();
      const numericValue = typeof value === 'number' ? value : Number(value);
      expect(numericValue).toBe(-4);
    });

    it('should treat null numeric operands as zero for comparison operators', async () => {
      const leftNumber = await createField(table1Id, {
        name: 'left-nullable-number',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 0 },
        },
      });

      const rightNumber = await createField(table1Id, {
        name: 'right-nullable-number',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 0 },
        },
      });

      const gtFormula = await createField(table1Id, {
        name: 'null-gt-zero-aware',
        type: FieldType.Formula,
        options: {
          expression: `IF({${leftNumber.id}} > {${rightNumber.id}}, 'left', 'right')`,
        },
      });

      const ltFormula = await createField(table1Id, {
        name: 'null-lt-zero-aware',
        type: FieldType.Formula,
        options: {
          expression: `IF({${leftNumber.id}} < {${rightNumber.id}}, 'less', 'not-less')`,
        },
      });

      const eqFormula = await createField(table1Id, {
        name: 'null-eq-zero-aware',
        type: FieldType.Formula,
        options: {
          expression: `IF({${leftNumber.id}} = {${rightNumber.id}}, 'equal', 'different')`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [rightNumber.name]: -1,
            },
          },
          {
            fields: {
              [rightNumber.name]: 3,
            },
          },
          {
            fields: {
              [rightNumber.name]: 0,
            },
          },
          {
            fields: {
              [leftNumber.name]: 2,
            },
          },
        ],
      });

      const expectations = [
        { gt: 'left', lt: 'not-less', eq: 'different' }, // null > -1 should behave like 0 > -1
        { gt: 'right', lt: 'less', eq: 'different' }, // null < 3 should behave like 0 < 3
        { gt: 'right', lt: 'not-less', eq: 'equal' }, // null = 0 should behave like 0 = 0
        { gt: 'left', lt: 'not-less', eq: 'different' }, // 2 > null should behave like 2 > 0
      ];

      records.forEach((record, index) => {
        const expected = expectations[index];
        expect(record.fields[gtFormula.name]).toBe(expected.gt);
        expect(record.fields[ltFormula.name]).toBe(expected.lt);
        expect(record.fields[eqFormula.name]).toBe(expected.eq);
      });
    });

    it('should evaluate nested logical formulas with mixed field types', async () => {
      const selectField = await createField(table1Id, {
        name: 'logical-select',
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { name: 'light', id: 'cho-light', color: 'grayBright' },
            { name: 'medium', id: 'cho-medium', color: 'yellowBright' },
            { name: 'heavy', id: 'cho-heavy', color: 'tealBright' },
          ],
        } as IFieldRo['options'],
      });

      const auxiliaryNumber = await createField(table1Id, {
        name: 'aux-number',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 0 },
        },
      });

      const complexLogicField = await createField(table1Id, {
        name: 'nested-mixed-logic',
        type: FieldType.Formula,
        options: {
          expression:
            `AND({${numberFieldRo.id}} > 0, ` +
            `OR({${selectField.id}} = "heavy", {${selectField.id}} = "medium"), ` +
            `{${textFieldRo.id}} != "", ` +
            `IF({${auxiliaryNumber.id}}, {${auxiliaryNumber.id}}, ""))`,
        },
      });

      const concatenationField = await createField(table1Id, {
        name: 'nested-mixed-string',
        type: FieldType.Formula,
        options: {
          expression: `2+2 & {${textFieldRo.id}} & {${selectField.id}} & 4 & "xxxxxxx"`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 12,
              [textFieldRo.name]: 'Alpha',
              [selectField.name]: 'heavy',
              [auxiliaryNumber.name]: 9,
            },
          },
        ],
      });

      const recordId = records[0].id;

      const readLogic = async () => {
        const record = await getRecord(table1Id, recordId);
        return record.data.fields[complexLogicField.name] as boolean;
      };

      const readConcat = async () => {
        const record = await getRecord(table1Id, recordId);
        return record.data.fields[concatenationField.name] as string;
      };

      let logicValue = await readLogic();
      expect(logicValue).toBe(true);

      let concatValue = await readConcat();
      expect(concatValue).toBe('4Alphaheavy4xxxxxxx');

      // Switch select choice to a value that should fail the OR expression.
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [selectField.name]: 'light',
          },
        },
      });

      logicValue = await readLogic();
      expect(logicValue).toBe(false);

      // Restore select, but clear the text field so another clause fails.
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [selectField.name]: 'medium',
            [textFieldRo.name]: '',
          },
        },
      });

      logicValue = await readLogic();
      expect(logicValue).toBe(false);

      // Restore text, zero out auxiliary number so IF branch yields NULL (still falsy).
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [textFieldRo.name]: 'Restored',
            [auxiliaryNumber.name]: 0,
          },
        },
      });

      logicValue = await readLogic();
      expect(logicValue).toBe(false);

      // Final update: all conditions satisfied again.
      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [textFieldRo.name]: 'Ready',
            [auxiliaryNumber.name]: 11,
          },
        },
      });

      logicValue = await readLogic();
      expect(logicValue).toBe(true);

      concatValue = await readConcat();
      expect(concatValue).toBe('4Readymedium4xxxxxxx');
    });

    it('should compare multi select values against literals inside IF branches', async () => {
      const equalityFormula = await createField(table1Id, {
        name: 'if-multi-select-equals',
        type: FieldType.Formula,
        options: {
          expression: `IF({${multiSelectFieldRo.id}} = "Alpha", 1, 2)`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [multiSelectFieldRo.name]: ['Alpha'],
            },
          },
        ],
      });
      const recordId = records[0].id;

      const readValue = async () => {
        const record = await getRecord(table1Id, recordId);
        return record.data.fields[equalityFormula.name];
      };

      let value = await readValue();
      expect(value).toBe(1);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [multiSelectFieldRo.name]: ['Beta'],
          },
        },
      });

      value = await readValue();
      expect(value).toBe(2);
    });

    it('should evaluate SWITCH formulas with numeric branches and blank literals', async () => {
      const statusField = await createField(table1Id, {
        name: 'switch-select',
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { name: 'light', id: 'cho-light', color: 'grayBright' },
            { name: 'medium', id: 'cho-medium', color: 'yellowBright' },
            { name: 'heavy', id: 'cho-heavy', color: 'tealBright' },
          ],
        } as IFieldRo['options'],
      });

      const amountField = await createField(table1Id, {
        name: 'switch-amount',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 0 },
        },
      });

      const switchFormula = await createField(table1Id, {
        name: 'switch-mixed-result',
        type: FieldType.Formula,
        options: {
          expression:
            `SWITCH({${statusField.id}}, ` +
            `"heavy", '', ` +
            `"medium", {${amountField.id}}, ` +
            `123)`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [statusField.name]: 'medium',
              [amountField.name]: 42,
            },
          },
        ],
      });

      const recordId = records[0].id;

      const readSwitchValue = async () => {
        const record = await getRecord(table1Id, recordId);
        return record.data.fields[switchFormula.name] as number | string | null;
      };

      let switchValue = await readSwitchValue();
      expect(Number(switchValue)).toBe(42);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [statusField.name]: 'heavy',
          },
        },
      });

      switchValue = await readSwitchValue();
      expect(switchValue ?? null).toBeNull();

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [statusField.name]: 'light',
          },
        },
      });

      switchValue = await readSwitchValue();
      expect(Number(switchValue)).toBe(123);
    });
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

  describe('IF truthiness normalization', () => {
    type TruthinessExpectation = 'TRUE' | 'FALSE';
    type TruthinessSetupResult = { condition: string; cleanup?: () => Promise<void> };
    type TruthinessCase = {
      name: string;
      expected: TruthinessExpectation;
      setup: (recordId: string) => Promise<TruthinessSetupResult>;
    };

    const truthinessCases: TruthinessCase[] = [
      {
        name: 'checkbox true',
        expected: 'TRUE',
        setup: async (recordId: string) => {
          const checkboxField = await createField(table1Id, {
            name: 'condition-checkbox-true',
            type: FieldType.Checkbox,
          });

          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [checkboxField.name]: true } },
          });

          return { condition: `{${checkboxField.id}}` };
        },
      },
      {
        name: 'checkbox false',
        expected: 'FALSE',
        setup: async (recordId: string) => {
          const checkboxField = await createField(table1Id, {
            name: 'condition-checkbox-false',
            type: FieldType.Checkbox,
          });

          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [checkboxField.name]: false } },
          });

          return { condition: `{${checkboxField.id}}` };
        },
      },
      {
        name: 'number zero',
        expected: 'FALSE',
        setup: async (recordId: string) => {
          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [numberFieldRo.name]: 0 } },
          });
          return { condition: `{${numberFieldRo.id}}` };
        },
      },
      {
        name: 'number positive',
        expected: 'TRUE',
        setup: async (recordId: string) => {
          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [numberFieldRo.name]: 42 } },
          });
          return { condition: `{${numberFieldRo.id}}` };
        },
      },
      {
        name: 'number null',
        expected: 'FALSE',
        setup: async (recordId: string) => {
          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [numberFieldRo.name]: null } },
          });
          return { condition: `{${numberFieldRo.id}}` };
        },
      },
      {
        name: 'text empty string',
        expected: 'FALSE',
        setup: async (recordId: string) => {
          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [textFieldRo.name]: '' } },
          });
          return { condition: `{${textFieldRo.id}}` };
        },
      },
      {
        name: 'text non-empty string',
        expected: 'TRUE',
        setup: async (recordId: string) => {
          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [textFieldRo.name]: 'value' } },
          });
          return { condition: `{${textFieldRo.id}}` };
        },
      },
      {
        name: 'text null',
        expected: 'FALSE',
        setup: async (recordId: string) => {
          await updateRecord(table1Id, recordId, {
            fieldKeyType: FieldKeyType.Name,
            record: { fields: { [textFieldRo.name]: null } },
          });
          return { condition: `{${textFieldRo.id}}` };
        },
      },
      {
        name: 'link with record',
        expected: 'TRUE',
        setup: async (recordId: string) => {
          const foreign = await createTable(baseId, {
            name: 'if-link-condition-foreign',
            fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
            records: [{ fields: { Title: 'Linked' } }],
          });

          const linkField = await createField(table1Id, {
            name: 'condition-link',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: foreign.id,
            } as ILinkFieldOptionsRo,
          } as IFieldRo);

          await updateRecordByApi(table1Id, recordId, linkField.id, {
            id: foreign.records[0].id,
          });

          const cleanup = async () => {
            await permanentDeleteTable(baseId, foreign.id);
          };

          return { condition: `{${linkField.id}}`, cleanup };
        },
      },
    ] as const;

    it('should evaluate IF condition truthiness across data types', async () => {
      const cleanupTasks: Array<() => Promise<void>> = [];

      try {
        for (const { setup, expected, name } of truthinessCases) {
          const { records } = await createRecords(table1Id, {
            fieldKeyType: FieldKeyType.Name,
            records: [
              {
                fields: {
                  [numberFieldRo.name]: numberFieldSeedValue,
                  [textFieldRo.name]: 'seed',
                },
              },
            ],
          });
          const recordId = records[0].id;

          const setupResult = await setup(recordId);
          const { condition } = setupResult;
          if (setupResult.cleanup) {
            cleanupTasks.push(setupResult.cleanup);
          }

          const formulaField = await createField(table1Id, {
            name: `if-truthiness-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            type: FieldType.Formula,
            options: {
              expression: `IF(${condition}, "TRUE", "FALSE")`,
            },
          });

          const recordAfterFormula = await getRecord(table1Id, recordId);
          const value = recordAfterFormula.data.fields[formulaField.name];

          expect(typeof value).toBe('string');
          expect(value).toBe(expected);
        }
      } finally {
        for (const task of cleanupTasks.reverse()) {
          await task();
        }
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

    it('should cascade checkbox formulas from numeric conditional rollup results', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-conditional-rollup-checkbox-foreign',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Title: 'Task Active', Status: 'Active' } },
          { fields: { Title: 'Task Closed', Status: 'Closed' } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-conditional-rollup-checkbox-host',
          fields: [{ name: 'StatusFilter', type: FieldType.SingleLineText } as IFieldRo],
          records: [
            { fields: { StatusFilter: 'Active' } },
            { fields: { StatusFilter: 'Pending' } },
          ],
        });

        const statusFieldId = foreign.fields.find((field) => field.name === 'Status')!.id;
        const titleFieldId = foreign.fields.find((field) => field.name === 'Title')!.id;
        const statusFilterFieldId = host.fields.find((field) => field.name === 'StatusFilter')!.id;

        const rollupField = await createField(host.id, {
          name: 'Has Matching Number',
          type: FieldType.ConditionalRollup,
          options: {
            foreignTableId: foreign.id,
            lookupFieldId: titleFieldId,
            expression: 'count({values})',
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

        const checkboxFormulaField = await createField(host.id, {
          name: 'Has Matching Checkbox',
          type: FieldType.Formula,
          options: {
            expression: `{${rollupField.id}} = 1`,
          },
        });

        const numericFormulaField = await createField(host.id, {
          name: 'Checkbox Numeric Mirror',
          type: FieldType.Formula,
          options: {
            expression: `IF({${checkboxFormulaField.id}}, 1, 0)`,
          },
        });

        const activeRecord = await getRecord(host.id, host.records[0].id);
        const pendingRecord = await getRecord(host.id, host.records[1].id);

        expect(activeRecord.data.fields[rollupField.name]).toBe(1);
        expect(typeof activeRecord.data.fields[rollupField.name]).toBe('number');
        expect(activeRecord.data.fields[checkboxFormulaField.name]).toBe(true);
        expect(typeof activeRecord.data.fields[checkboxFormulaField.name]).toBe('boolean');
        expect(activeRecord.data.fields[numericFormulaField.name]).toBe(1);
        expect(typeof activeRecord.data.fields[numericFormulaField.name]).toBe('number');

        expect(pendingRecord.data.fields[rollupField.name]).toBe(0);
        expect(typeof pendingRecord.data.fields[rollupField.name]).toBe('number');
        expect(pendingRecord.data.fields[checkboxFormulaField.name]).toBe(false);
        expect(typeof pendingRecord.data.fields[checkboxFormulaField.name]).toBe('boolean');
        expect(pendingRecord.data.fields[numericFormulaField.name]).toBe(0);
        expect(typeof pendingRecord.data.fields[numericFormulaField.name]).toBe('number');
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

    const dateAddArgumentMatrix: Array<{
      label: string;
      requiresFormulaField: boolean;
      buildExpression: (ids: { numberFieldId: string; numberFormulaFieldId?: string }) => string;
      expectedShift: (baseNumberValue: number) => number;
    }> = [
      {
        label: `DATE_ADD(DATETIME_PARSE("2025-01-03"), 1, 'day')`,
        requiresFormulaField: false,
        buildExpression: () => `DATE_ADD(DATETIME_PARSE("2025-01-03"), 1, 'day')`,
        expectedShift: () => 1,
      },
      {
        label: `DATE_ADD(DATETIME_PARSE("2025-01-03"), {NumberField}, 'day')`,
        requiresFormulaField: false,
        buildExpression: ({ numberFieldId }) =>
          `DATE_ADD(DATETIME_PARSE("2025-01-03"), {${numberFieldId}}, 'day')`,
        expectedShift: (baseNumberValue) => baseNumberValue,
      },
      {
        label: `DATE_ADD(DATETIME_PARSE("2025-01-03"), {NumberFormulaField}, 'day')`,
        requiresFormulaField: true,
        buildExpression: ({ numberFormulaFieldId }) =>
          `DATE_ADD(DATETIME_PARSE("2025-01-03"), {${numberFormulaFieldId}}, 'day')`,
        expectedShift: (baseNumberValue) => baseNumberValue * 2,
      },
    ];

    it.each(dateAddArgumentMatrix)(
      'should evaluate DATE_ADD when count argument comes from %s',
      async ({ label, requiresFormulaField, buildExpression, expectedShift }) => {
        const baseNumberValue = 3;
        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [numberFieldRo.name]: baseNumberValue,
              },
            },
          ],
        });
        const recordId = records[0].id;

        let numberFormulaFieldId: string | undefined;
        if (requiresFormulaField) {
          const numberFormulaField = await createField(table1Id, {
            name: `date-add-count-formula-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
            type: FieldType.Formula,
            options: {
              expression: `{${numberFieldRo.id}} * 2`,
            },
          });
          numberFormulaFieldId = numberFormulaField.id;
        }

        const dateAddField = await createField(table1Id, {
          name: `date-add-permutation-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
          type: FieldType.Formula,
          options: {
            expression: buildExpression({
              numberFieldId: numberFieldRo.id,
              numberFormulaFieldId,
            }),
          },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const rawValue = recordAfterFormula.data.fields[dateAddField.name];
        expect(typeof rawValue).toBe('string');

        const expectedDate = addToDate(
          new Date('2025-01-03T00:00:00.000Z'),
          expectedShift(baseNumberValue),
          'day'
        );
        expect(rawValue).toBe(expectedDate.toISOString());
      }
    );

    it('should apply DATE_ADD to the first value when lookup returns multiple dates', async () => {
      const foreign = await createTable(baseId, {
        name: 'formula-date-add-lookup-foreign',
        fields: [
          { name: 'Order', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Signup Date', type: FieldType.Date } as IFieldRo,
        ],
        records: [
          { fields: { Order: 'A', 'Signup Date': '2024-05-01T00:00:00.000Z' } },
          { fields: { Order: 'B', 'Signup Date': '2024-05-03T12:00:00.000Z' } },
        ],
      });
      let host: ITableFullVo | undefined;
      try {
        host = await createTable(baseId, {
          name: 'formula-date-add-lookup-host',
          fields: [{ name: 'Name', type: FieldType.SingleLineText } as IFieldRo],
          records: [{ fields: { Name: 'Host row' } }],
        });

        const linkField = await createField(host.id, {
          name: 'Related Orders',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
          } as ILinkFieldOptionsRo,
        } as IFieldRo);

        const signupDateFieldId = foreign.fields.find((field) => field.name === 'Signup Date')!.id;
        const lookupField = await createField(host.id, {
          name: 'Signup Dates',
          type: FieldType.Date,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: signupDateFieldId,
            linkFieldId: linkField.id,
          } as ILookupOptionsRo,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        } as IFieldRo);

        const dateAddField = await createField(host.id, {
          name: 'Signup Date +14d',
          type: FieldType.Formula,
          options: {
            expression: `DATE_ADD({${lookupField.id}}, 14, 'day')`,
          },
        } as IFieldRo);

        const hostRecordId = host.records[0].id;
        await updateRecordByApi(
          host.id,
          hostRecordId,
          linkField.id,
          foreign.records.map((record) => ({ id: record.id }))
        );

        const recordAfter = await getRecord(host.id, hostRecordId);
        expect(recordAfter.data.fields[lookupField.name]).toEqual([
          '2024-05-01T00:00:00.000Z',
          '2024-05-03T12:00:00.000Z',
        ]);

        expect(recordAfter.data.fields[dateAddField.name]).toBe(
          addToDate(new Date('2024-05-01T00:00:00.000Z'), 14, 'day').toISOString()
        );
      } finally {
        if (host) {
          await permanentDeleteTable(baseId, host.id);
        }
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

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
            expression: `DATETIME_DIFF(DATETIME_PARSE("${datetimeDiffEndIso}"), DATETIME_PARSE("${datetimeDiffStartIso}"), '${literal}')`,
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

    it('should evaluate DATETIME_DIFF default unit when end precedes start', async () => {
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
        name: `datetime-diff-default-order`,
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_DIFF(DATETIME_PARSE("${datetimeDiffEndIso}"), DATETIME_PARSE("${datetimeDiffStartIso}"))`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const rawValue = recordAfterFormula.data.fields[diffField.name];
      if (typeof rawValue === 'number') {
        expect(rawValue).toBeCloseTo(diffDays, 6);
      } else {
        const numericValue = Number(rawValue);
        expect(Number.isFinite(numericValue)).toBe(true);
        expect(numericValue).toBeCloseTo(diffDays, 6);
      }
    });

    it.each([
      {
        unit: 'month',
        start: '2024-01-31T00:00:00.000Z',
        end: '2024-02-29T00:00:00.000Z',
        expected: 1,
      },
      {
        unit: 'months',
        start: '2024-01-31T00:00:00.000Z',
        end: '2024-02-29T00:00:00.000Z',
        expected: 1,
      },
      {
        unit: 'quarter',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-04-01T00:00:00.000Z',
        expected: 1,
      },
      {
        unit: 'quarters',
        start: '2025-01-01T00:00:00.000Z',
        end: '2025-04-01T00:00:00.000Z',
        expected: 1,
      },
      {
        unit: 'year',
        start: '2024-01-01T00:00:00.000Z',
        end: '2025-01-01T00:00:00.000Z',
        expected: 1,
      },
      {
        unit: 'years',
        start: '2024-01-01T00:00:00.000Z',
        end: '2025-01-01T00:00:00.000Z',
        expected: 1,
      },
    ])(
      'should evaluate DATETIME_DIFF for month/quarter/year spans using unit "%s"',
      async ({ unit, start, end, expected }) => {
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
          name: `datetime-diff-${unit}-span`,
          type: FieldType.Formula,
          options: {
            expression: `DATETIME_DIFF(DATETIME_PARSE("${end}"), DATETIME_PARSE("${start}"), '${unit}')`,
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

    it('should not persist chained DATETIME_DIFF formula as generated column', async () => {
      const startDateField = await createField(table1Id, {
        name: 'shift-start',
        type: FieldType.Date,
      } as IFieldRo);
      const endDateField = await createField(table1Id, {
        name: 'shift-end',
        type: FieldType.Date,
      } as IFieldRo);

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [startDateField.name]: '2025-04-10T08:15:00.000Z',
              [endDateField.name]: '2025-04-10T09:45:00.000Z',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const durationField = await createField(table1Id, {
        name: 'shift-duration-minutes',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_DIFF({${endDateField.id}}, {${startDateField.id}}, 'minute')`,
        },
      });

      const remainingField = await createField(table1Id, {
        name: 'shift-remaining',
        type: FieldType.Formula,
        options: {
          expression: `{${durationField.id}} - 1`,
        },
      });

      const recordAfterFormula = await getRecord(table1Id, recordId);
      const rawDuration = recordAfterFormula.data.fields[durationField.name];
      const duration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration);
      expect(duration).toBeCloseTo(90, 6);

      const rawRemaining = recordAfterFormula.data.fields[remainingField.name];
      const remaining = typeof rawRemaining === 'number' ? rawRemaining : Number(rawRemaining);
      expect(remaining).toBeCloseTo(89, 6);

      const refreshedRemainingField = await getField(table1Id, remainingField.id);
      const rawMeta = refreshedRemainingField.meta as unknown;
      let persistedAsGeneratedColumn: boolean | undefined;
      if (typeof rawMeta === 'string') {
        persistedAsGeneratedColumn = (
          JSON.parse(rawMeta) as { persistedAsGeneratedColumn?: boolean }
        ).persistedAsGeneratedColumn;
      } else if (rawMeta && typeof rawMeta === 'object') {
        persistedAsGeneratedColumn = (rawMeta as { persistedAsGeneratedColumn?: boolean })
          .persistedAsGeneratedColumn;
      }
      expect(persistedAsGeneratedColumn).not.toBe(true);
    });

    it('should evaluate DATETIME_DIFF when referencing string formula fields using "+"', async () => {
      let table: ITableFullVo | undefined;
      try {
        table = await createTable(baseId, {
          name: 'datetime-diff-from-text-formulas',
          fields: [
            { name: 'Name', type: FieldType.SingleLineText } as IFieldRo,
            {
              name: 'shift-date-only',
              type: FieldType.Date,
              options: {
                formatting: {
                  date: DateFormattingPreset.ISO,
                  time: TimeFormatting.None,
                  timeZone: 'Etc/GMT-8',
                },
              },
            } as IFieldRo,
            { name: 'shift-start-time', type: FieldType.SingleLineText } as IFieldRo,
            { name: 'shift-end-time', type: FieldType.SingleLineText } as IFieldRo,
          ],
          records: [
            {
              fields: {
                Name: 'row',
                'shift-date-only': '2025-10-31T16:00:00.000Z',
                'shift-start-time': '8:40',
                'shift-end-time': '8:57',
              },
            },
          ],
        });

        const dateField = table.fields.find((f) => f.name === 'shift-date-only')!;
        const startTimeField = table.fields.find((f) => f.name === 'shift-start-time')!;
        const endTimeField = table.fields.find((f) => f.name === 'shift-end-time')!;
        const recordId = table.records[0].id;

        const startDatetimeText = await createField(table.id, {
          name: 'shift-start-datetime-text',
          type: FieldType.Formula,
          options: {
            expression: `DATESTR({${dateField.id}}) + " " + DATETIME_FORMAT(DATESTR({${dateField.id}}) + " " + {${startTimeField.id}}, "HH:mm:ss")`,
            timeZone: 'Asia/Shanghai',
          },
        } as IFieldRo);

        const endDatetimeText = await createField(table.id, {
          name: 'shift-end-datetime-text',
          type: FieldType.Formula,
          options: {
            expression: `DATESTR({${dateField.id}}) + " " + DATETIME_FORMAT(DATESTR({${dateField.id}}) + " " + {${endTimeField.id}}, "HH:mm:ss")`,
            timeZone: 'Etc/GMT-8',
          },
        } as IFieldRo);

        const durationMinutes = await createField(table.id, {
          name: 'shift-duration-minutes-from-text',
          type: FieldType.Formula,
          options: {
            expression: `DATETIME_DIFF({${endDatetimeText.id}}, {${startDatetimeText.id}}, "minute")`,
            timeZone: 'Etc/GMT-8',
          },
        } as IFieldRo);

        const recordAfterFormula = await getRecord(table.id, recordId);
        const rawDuration = recordAfterFormula.data.fields[durationMinutes.name];
        const duration = typeof rawDuration === 'number' ? rawDuration : Number(rawDuration);
        expect(duration).toBeCloseTo(17, 6);
      } finally {
        if (table) {
          await permanentDeleteTable(baseId, table.id);
        }
      }
    });

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
        name: 'WEEKDAY_MONDAY',
        expression: `WEEKDAY(DATETIME_PARSE("2025-04-15T10:20:30Z"), "Monday")`,
        expected: 1,
      },
      {
        name: 'WEEKDAY_SUNDAY',
        expression: `WEEKDAY(DATETIME_PARSE("2025-04-15T10:20:30Z"), "Sunday")`,
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
          // Use UTC timezone to ensure deterministic results across different local timezones
          options: { expression, timeZone: 'UTC' },
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
          // Use UTC timezone to ensure deterministic results across different local timezones
          options: { expression, timeZone: 'UTC' },
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

  describe('formula argument permutations', () => {
    const literalNumberValue = 4;
    const literalTextValue = 'literal-matrix';
    const fallbackTextValue = 'fallback-matrix';

    type SumArgSource = 'literal' | 'field' | 'formula';
    const sumArgumentSources: Record<
      SumArgSource,
      {
        toExpression: (ids: { numberFieldId: string; numberFormulaFieldId?: string }) => string;
        toValue: (ctx: { numberValue: number; numberFormulaValue?: number }) => number;
        requiresFormulaField?: boolean;
      }
    > = {
      literal: {
        toExpression: () => `${literalNumberValue}`,
        toValue: () => literalNumberValue,
      },
      field: {
        toExpression: ({ numberFieldId }) => `{${numberFieldId}}`,
        toValue: ({ numberValue }) => numberValue,
      },
      formula: {
        requiresFormulaField: true,
        toExpression: ({ numberFormulaFieldId }) => `{${numberFormulaFieldId}}`,
        toValue: ({ numberFormulaValue }) => numberFormulaValue ?? 0,
      },
    };

    const sumArgumentCombinations = (['literal', 'field', 'formula'] as SumArgSource[]).flatMap(
      (first) =>
        (['literal', 'field', 'formula'] as SumArgSource[]).map((second) => ({
          label: `${first} + ${second}`,
          args: [first, second] as [SumArgSource, SumArgSource],
        }))
    );

    it.each(sumArgumentCombinations)(
      'should evaluate SUM when arguments come from %s',
      async ({ args, label }) => {
        const baseNumberValue = 3;
        const baseTextValue = 'matrix-text';

        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [numberFieldRo.name]: baseNumberValue,
                [textFieldRo.name]: baseTextValue,
              },
            },
          ],
        });
        const recordId = records[0].id;

        let numberFormulaFieldId: string | undefined;
        if (args.some((source) => sumArgumentSources[source].requiresFormulaField)) {
          const numberFormulaField = await createField(table1Id, {
            name: `sum-argument-source-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
            type: FieldType.Formula,
            options: {
              expression: `{${numberFieldRo.id}} * 2`,
            },
          });
          numberFormulaFieldId = numberFormulaField.id;
        }

        const argExpressions = args.map((source) =>
          sumArgumentSources[source].toExpression({
            numberFieldId: numberFieldRo.id,
            numberFormulaFieldId,
          })
        );

        const formulaField = await createField(table1Id, {
          name: `sum-argument-matrix-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
          type: FieldType.Formula,
          options: {
            expression: `SUM(${argExpressions.join(', ')})`,
          },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        expect(typeof value).toBe('number');

        const numberFormulaValue = numberFormulaFieldId ? baseNumberValue * 2 : undefined;
        const expectedSum = args.reduce(
          (acc, source) =>
            acc +
            sumArgumentSources[source].toValue({
              numberValue: baseNumberValue,
              numberFormulaValue,
            }),
          0
        );
        expect(value).toBeCloseTo(expectedSum, 6);
      }
    );

    it('should treat boolean comparisons on single select fields as numeric inside SUM', async () => {
      const selectFields = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          createField(table1Id, {
            name: `sum-select-${index + 1}`,
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { id: `select-${index + 1}-nb`, name: 'NB' },
                { id: `select-${index + 1}-other`, name: 'WB' },
              ],
            } as ISelectFieldOptionsRo,
          })
        )
      );

      const equalityExpressions = selectFields.map((field) => `{${field.id}} = "NB"`);

      const formulaField = await createField(table1Id, {
        name: 'sum-select-boolean-coercion',
        type: FieldType.Formula,
        options: {
          expression: `SUM(${equalityExpressions.join(', ')})`,
        },
      });

      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [selectFields[0].name]: 'NB',
              [selectFields[1].name]: 'NB',
              [selectFields[2].name]: 'WB',
            },
          },
        ],
      });
      const recordId = records[0].id;

      const readSumValue = async () => {
        const record = await getRecord(table1Id, recordId);
        return record.data.fields[formulaField.name] as number;
      };

      let sumValue = await readSumValue();
      expect(typeof sumValue).toBe('number');
      expect(sumValue).toBe(2);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [selectFields[0].name]: 'NB',
            [selectFields[1].name]: 'NB',
            [selectFields[2].name]: 'NB',
          },
        },
      });

      sumValue = await readSumValue();
      expect(sumValue).toBe(3);

      await updateRecord(table1Id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [selectFields[0].name]: 'WB',
            [selectFields[1].name]: 'WB',
            [selectFields[2].name]: 'WB',
          },
        },
      });

      sumValue = await readSumValue();
      expect(sumValue).toBe(0);
    });

    const mixedFunctionCases: Array<{
      label: FunctionName;
      expressionFactory: (ids: {
        numberFieldId: string;
        numberFormulaFieldId: string;
        textFieldId: string;
        textFormulaFieldId: string;
      }) => string;
      assert: (
        value: unknown,
        ctx: { numberValue: number; numberFormulaValue: number; textValue: string }
      ) => void;
    }> = [
      {
        label: FunctionName.Round,
        expressionFactory: ({ numberFieldId, numberFormulaFieldId }) =>
          `ROUND({${numberFormulaFieldId}} / {${numberFieldId}}, 0)`,
        assert: (value) => {
          expect(typeof value).toBe('number');
          expect(value).toBe(2);
        },
      },
      {
        label: FunctionName.Concatenate,
        expressionFactory: ({ numberFormulaFieldId, textFieldId, textFormulaFieldId }) =>
          `CONCATENATE("${literalTextValue}", "-", {${textFieldId}}, "-", {${numberFormulaFieldId}}, "-", {${textFormulaFieldId}})`,
        assert: (value, ctx) => {
          expect(typeof value).toBe('string');
          const textFormulaValue = `${ctx.numberValue}${ctx.textValue}`;
          expect(value).toBe(
            `${literalTextValue}-${ctx.textValue}-${ctx.numberFormulaValue}-${textFormulaValue}`
          );
        },
      },
      {
        label: FunctionName.If,
        expressionFactory: ({ numberFieldId, numberFormulaFieldId, textFieldId }) =>
          `IF({${numberFormulaFieldId}} > {${numberFieldId}}, {${textFieldId}}, "${fallbackTextValue}")`,
        assert: (value, ctx) => {
          expect(typeof value).toBe('string');
          expect(value).toBe(
            ctx.numberFormulaValue > ctx.numberValue ? ctx.textValue : fallbackTextValue
          );
        },
      },
    ];

    it.each(mixedFunctionCases)(
      'should evaluate %s with mixed literal and field arguments',
      async ({ label, expressionFactory, assert }) => {
        const baseNumberValue = 3;
        const baseTextValue = 'matrix-text';

        const { records } = await createRecords(table1Id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                [numberFieldRo.name]: baseNumberValue,
                [textFieldRo.name]: baseTextValue,
              },
            },
          ],
        });
        const recordId = records[0].id;

        const numberFormulaField = await createField(table1Id, {
          name: `mixed-function-source-${label.toLowerCase()}`,
          type: FieldType.Formula,
          options: {
            expression: `{${numberFieldRo.id}} * 2`,
          },
        });

        const formulaField = await createField(table1Id, {
          name: `mixed-function-matrix-${label.toLowerCase()}`,
          type: FieldType.Formula,
          options: {
            expression: expressionFactory({
              numberFieldId: numberFieldRo.id,
              numberFormulaFieldId: numberFormulaField.id,
              textFieldId: textFieldRo.id,
              textFormulaFieldId: formulaFieldRo.id,
            }),
          },
        });

        const recordAfterFormula = await getRecord(table1Id, recordId);
        const value = recordAfterFormula.data.fields[formulaField.name];
        assert(value, {
          numberValue: baseNumberValue,
          numberFormulaValue: baseNumberValue * 2,
          textValue: baseTextValue,
        });
      }
    );

    it('should treat DATETIME_PARSE without format as null when generated string is invalid', async () => {
      const dateField = await createField(table1Id, {
        name: 'source-birthday',
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
            timeZone: 'Asia/Shanghai',
          },
        },
      });

      const formulaField = await createField(table1Id, {
        name: 'birthday-anniversary',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_PARSE(YEAR(TODAY()) & '-' & MONTH({${dateField.id}}) & '-' & DAY({${dateField.id}}))`,
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

      const recordAfterFormula = await getRecord(table1Id, records[0].id);
      const value = recordAfterFormula.data.fields[formulaField.name] ?? null;
      expect(value).toBeNull();
    });

    it('should bypass DATETIME_PARSE guard for direct date field references', async () => {
      const dateField = await createField(table1Id, {
        name: 'source-date-field',
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
            timeZone: 'UTC',
          },
        },
      });

      const formulaField = await createField(table1Id, {
        name: 'date-passthrough',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_PARSE({${dateField.id}})`,
        },
      });

      const sourceIso = '2024-05-20T09:30:00.000Z';
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [dateField.name]: sourceIso,
            },
          },
        ],
      });

      const recordAfterFormula = await getRecord(table1Id, records[0].id);
      const value = recordAfterFormula.data.fields[formulaField.name];
      expect(value).toBe(sourceIso);
    });

    it('should allow DATETIME_PARSE to consume DATE_ADD output with literal time fragments', async () => {
      const dateField = await createField(table1Id, {
        name: 'month-end',
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.Hour24,
            timeZone: 'UTC',
          },
        },
      });

      const formulaField = await createField(table1Id, {
        name: 'month-start',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_PARSE(DATE_ADD({${dateField.id}}, 1 - DAY({${dateField.id}}), 'day'), 'YYYY-MM-DD 00:00')`,
          // Use UTC timezone to ensure deterministic results across different local timezones
          timeZone: 'UTC',
        },
      });

      const sourceIso = '2025-11-19T00:00:00.000Z';
      const expectedIso = '2025-11-01T00:00:00.000Z';
      const { records } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [dateField.name]: sourceIso,
            },
          },
        ],
      });

      const recordAfterFormula = await getRecord(table1Id, records[0].id);
      const value = recordAfterFormula.data.fields?.[formulaField.name] ?? null;
      expect(value).toBe(expectedIso);
    });

    it('should coerce blank IF branch to null for datetime results', async () => {
      const dateField = await createField(table1Id, {
        name: 'source-date',
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.None,
            timeZone: 'Asia/Shanghai',
          },
        },
      });

      const datetimeFormulaField = await createField(table1Id, {
        name: 'nullable-datetime-formula',
        type: FieldType.Formula,
        options: {
          expression: `IF(YEAR({${dateField.id}}) < 2020, '', {${dateField.id}})`,
        },
      });

      const initialIso = '2019-05-01T00:00:00.000Z';
      const { records: createdRecords } = await createRecords(table1Id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            fields: {
              [numberFieldRo.name]: 10,
              [textFieldRo.name]: 'trigger-null',
              [dateField.name]: initialIso,
            },
          },
        ],
      });

      const createdRecord = createdRecords[0];
      const recordAfterCreate = await getRecord(table1Id, createdRecord.id);
      const createdFormulaValue =
        recordAfterCreate.data.fields?.[datetimeFormulaField.name] ?? null;
      expect(createdFormulaValue).toBeNull();

      const updatedIso = '2024-05-01T12:00:00.000Z';
      const updatedRecord = await updateRecord(table1Id, createdRecord.id, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [dateField.name]: updatedIso,
          },
        },
      });

      const updatedValue = updatedRecord.fields?.[datetimeFormulaField.name] as string | null;
      expect(updatedValue).not.toBeNull();
      expect(typeof updatedValue).toBe('string');
      expect(updatedValue).toContain('2024');

      const recordAfterUpdate = await getRecord(table1Id, createdRecord.id);
      const persistedValue = recordAfterUpdate.data.fields?.[datetimeFormulaField.name] as
        | string
        | null;
      expect(persistedValue).not.toBeNull();
      expect(typeof persistedValue).toBe('string');
      expect(persistedValue).toContain('2024');
    });
  });

  it('should evaluate link equality formula comparing link title and concatenated text', async () => {
    const foreign = await createTable(baseId, {
      name: 'link-equality-foreign',
      fields: [{ name: 'Title', type: FieldType.SingleLineText } as IFieldRo],
      records: [{ fields: { Title: 'AlphaSet1' } }],
    });
    let host: ITableFullVo | undefined;
    try {
      host = await createTable(baseId, {
        name: 'link-equality-host',
        fields: [
          { name: 'Ad', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Adset', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [{ fields: { Ad: 'Alpha', Adset: 'Set1' } }],
      });

      const adField = host.fields.find((field) => field.name === 'Ad')!;
      const adsetField = host.fields.find((field) => field.name === 'Adset')!;

      const concatenatedField = await createField(host.id, {
        name: 'Ad & Adset',
        type: FieldType.Formula,
        options: {
          expression: `{${adField.id}} & {${adsetField.id}}`,
        },
      });

      const linkField = await createField(host.id, {
        name: 'Related Campaign',
        type: FieldType.Link,
        options: {
          foreignTableId: foreign.id,
          relationship: Relationship.ManyOne,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const equalityField = await createField(host.id, {
        name: 'Link Matches Text',
        type: FieldType.Formula,
        options: {
          expression: `{${linkField.id}} = {${concatenatedField.id}}`,
        },
      });

      const recordId = host.records[0].id;
      await updateRecordByApi(host.id, recordId, linkField.id, {
        id: foreign.records[0].id,
      });

      let record = await getRecord(host.id, recordId);
      expect(record.data.fields[concatenatedField.name]).toBe('AlphaSet1');
      expect(record.data.fields[equalityField.name]).toBe(true);

      await updateRecord(host.id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [adField.name]: 'Beta',
          },
        },
      });

      record = await getRecord(host.id, recordId);
      expect(record.data.fields[concatenatedField.name]).toBe('BetaSet1');
      expect(record.data.fields[equalityField.name]).toBe(false);
    } finally {
      if (host) {
        await permanentDeleteTable(baseId, host.id);
      }
      await permanentDeleteTable(baseId, foreign.id);
    }
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

  it('should format link titles using foreign field formatting', async () => {
    const foreignDate = await createTable(baseId, {
      name: 'link-format-date-foreign',
      fields: [
        {
          name: 'Due Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.Asian,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        } as IFieldRo,
      ],
      records: [
        {
          fields: {
            'Due Date': '2024-05-06T01:23:45.000Z',
          },
        },
        {
          fields: {
            'Due Date': '2024-05-07T09:00:00.000Z',
          },
        },
      ],
    });

    const foreignNumber = await createTable(baseId, {
      name: 'link-format-number-foreign',
      fields: [
        {
          name: 'Completion',
          type: FieldType.Number,
          options: {
            formatting: {
              type: NumberFormattingType.Percent,
              precision: 1,
            },
          },
        } as IFieldRo,
      ],
      records: [
        {
          fields: {
            Completion: 0.321,
          },
        },
        {
          fields: {
            Completion: 0.875,
          },
        },
      ],
    });

    let host: ITableFullVo | undefined;
    try {
      host = await createTable(baseId, {
        name: 'link-format-host',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Label: 'host row' } }],
      });

      const dateLinkField = await createField(host.id, {
        name: 'Date Link',
        type: FieldType.Link,
        options: {
          foreignTableId: foreignDate.id,
          relationship: Relationship.ManyOne,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const dateMultiLinkField = await createField(host.id, {
        name: 'Date Links',
        type: FieldType.Link,
        options: {
          foreignTableId: foreignDate.id,
          relationship: Relationship.ManyMany,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const numberLinkField = await createField(host.id, {
        name: 'Number Link',
        type: FieldType.Link,
        options: {
          foreignTableId: foreignNumber.id,
          relationship: Relationship.ManyOne,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const numberMultiLinkField = await createField(host.id, {
        name: 'Number Links',
        type: FieldType.Link,
        options: {
          foreignTableId: foreignNumber.id,
          relationship: Relationship.ManyMany,
        } as ILinkFieldOptionsRo,
      } as IFieldRo);

      const hostRecordId = host.records[0].id;

      await updateRecordByApi(host.id, hostRecordId, dateLinkField.id, {
        id: foreignDate.records[0].id,
      });

      await updateRecordByApi(
        host.id,
        hostRecordId,
        dateMultiLinkField.id,
        foreignDate.records.map((record) => ({ id: record.id }))
      );

      await updateRecordByApi(host.id, hostRecordId, numberLinkField.id, {
        id: foreignNumber.records[0].id,
      });

      await updateRecordByApi(
        host.id,
        hostRecordId,
        numberMultiLinkField.id,
        foreignNumber.records.map((record) => ({ id: record.id }))
      );

      const record = await getRecord(host.id, hostRecordId);
      const dateLink = record.data.fields[dateLinkField.name] as {
        id: string;
        title: string;
      } | null;
      expect(dateLink).toBeDefined();
      expect(dateLink?.id).toBe(foreignDate.records[0].id);
      expect(dateLink?.title).toBe('2024/05/06');

      const numberLink = record.data.fields[numberLinkField.name] as {
        id: string;
        title: string;
      } | null;
      expect(numberLink).toBeDefined();
      expect(numberLink?.id).toBe(foreignNumber.records[0].id);
      expect(numberLink?.title).toBe('32.1%');

      const dateMultiLink = record.data.fields[dateMultiLinkField.name] as Array<{
        id: string;
        title: string;
      }> | null;
      expect(Array.isArray(dateMultiLink)).toBe(true);
      expect(dateMultiLink?.length).toBe(2);
      const dateMultiTitles = dateMultiLink?.map((item) => item.title);
      expect(dateMultiTitles).toEqual(['2024/05/06', '2024/05/07']);

      const numberMultiLink = record.data.fields[numberMultiLinkField.name] as Array<{
        id: string;
        title: string;
      }> | null;
      expect(Array.isArray(numberMultiLink)).toBe(true);
      expect(numberMultiLink?.length).toBe(2);
      const numberMultiTitles = numberMultiLink?.map((item) => item.title);
      expect(numberMultiTitles).toEqual(['32.1%', '87.5%']);
    } finally {
      if (host) {
        await permanentDeleteTable(baseId, host.id);
      }
      await permanentDeleteTable(baseId, foreignDate.id);
      await permanentDeleteTable(baseId, foreignNumber.id);
    }
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

    it('should default formula timeZone when missing', async () => {
      const inputIso = '2024-02-28T00:00:00+09:00';
      // Use system default timezone instead of hardcoded 'UTC'
      const defaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const field = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `DAY("${inputIso}")`,
        },
      });

      const fieldOptions = field.options as { timeZone?: string } | undefined;
      expect(fieldOptions?.timeZone).toEqual(defaultTimeZone);

      const record = await getRecord(table.id, table.records[0].id);
      const expectedDay = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: defaultTimeZone,
          day: '2-digit',
        }).format(new Date(inputIso))
      );

      expect(record.data.fields[field.name]).toEqual(expectedDay);
    });

    it('should bucket Created On records using NOW() formula', async () => {
      const createdOnField = await createField(table.id, {
        name: 'Created On',
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.Hour24,
            timeZone: 'UTC',
          },
        },
      });

      const formulaField = await createField(table.id, {
        name: 'Pitch Day',
        type: FieldType.Formula,
        options: {
          expression: `IF(DATETIME_DIFF(NOW(), {${createdOnField.id}}, "day")<1, "Today", IF(DATETIME_DIFF(NOW(), {${createdOnField.id}}, "day")<2, "Yesterday", "Older"))`,
          timeZone: 'UTC',
        },
      });

      const now = Date.now();
      const records = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [createdOnField.id]: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
            },
          },
          {
            fields: {
              [createdOnField.id]: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
            },
          },
          {
            fields: {
              [createdOnField.id]: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        ],
      });

      const todayRecord = await getRecord(table.id, records.records[0].id);
      expect(todayRecord.data.fields[formulaField.name]).toEqual('Today');

      const yesterdayRecord = await getRecord(table.id, records.records[1].id);
      expect(yesterdayRecord.data.fields[formulaField.name]).toEqual('Yesterday');

      const olderRecord = await getRecord(table.id, records.records[2].id);
      expect(olderRecord.data.fields[formulaField.name]).toEqual('Older');
    });

    it('should evaluate formula referencing created time on record create', async () => {
      const createdTimeField = await createField(table.id, {
        name: 'Created time',
        type: FieldType.CreatedTime,
      });

      const formulaField = await createField(table.id, {
        name: 'Created age (days)',
        type: FieldType.Formula,
        options: {
          expression: `DATETIME_DIFF(NOW(), {${createdTimeField.id}}, "day")`,
          timeZone: 'UTC',
        },
      });

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: {} }],
      });

      const record = await getRecord(table.id, created.records[0].id);
      expect(record.data.fields[formulaField.name]).toEqual(0);
    });

    it('should evaluate formula referencing created by on record create', async () => {
      const createdByField = await createField(table.id, {
        name: 'Created by',
        type: FieldType.CreatedBy,
      });

      const formulaField = await createField(table.id, {
        name: 'Creator Name',
        type: FieldType.Formula,
        options: {
          expression: `{${createdByField.id}}`,
        },
      });

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: {} }],
      });

      const record = await getRecord(table.id, created.records[0].id);
      const createdByValue = record.data.fields[createdByField.name] as { title?: string } | null;
      expect(createdByValue?.title).toBeTruthy();
      expect(record.data.fields[formulaField.name]).toEqual(createdByValue?.title);
    });

    it('should evaluate formula referencing auto number on record create', async () => {
      const autoNumberField = await createField(table.id, {
        name: 'Auto number',
        type: FieldType.AutoNumber,
      });

      const formulaField = await createField(table.id, {
        name: 'Auto number x2',
        type: FieldType.Formula,
        options: {
          expression: `{${autoNumberField.id}} * 2`,
        },
      });

      const created = await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: {} }],
      });

      const record = await getRecord(table.id, created.records[0].id);
      const autoNumberValue = record.data.fields[autoNumberField.name] as number;
      expect(record.data.fields[formulaField.name]).toEqual(autoNumberValue * 2);
    });

    it('should evaluate timezone-aware formatting formulas referencing fields', async () => {
      const dateField = await createField(table.id, {
        name: 'tz source',
        type: FieldType.Date,
        options: {
          formatting: {
            date: DateFormattingPreset.ISO,
            time: TimeFormatting.Hour24,
            timeZone: 'Asia/Tokyo',
          },
        },
      });

      const recordId = table.records[0].id;
      const inputValue = '2024-03-01T00:30:00+09:00';
      const updatedRecord = await updateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [dateField.name]: inputValue,
          },
        },
      });
      const sourceValue = updatedRecord.fields?.[dateField.name] as string;
      expect(typeof sourceValue).toBe('string');

      const expectedDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(sourceValue));

      const expectedTime = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .format(new Date(sourceValue))
        .replace(/\./g, ':'); // ensure consistent separators on all locales

      const dateStrField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `DATESTR({${dateField.id}})`,
          timeZone: 'Asia/Shanghai',
        },
      });

      let record = await getRecord(table.id, recordId);
      expect(record.data.fields[dateStrField.name]).toEqual(expectedDate);

      const timeStrField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `TIMESTR({${dateField.id}})`,
          timeZone: 'Asia/Shanghai',
        },
      });

      record = await getRecord(table.id, recordId);
      expect(record.data.fields[timeStrField.name]).toEqual(expectedTime);

      const workdayField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `DATESTR(WORKDAY({${dateField.id}}, 1))`,
          timeZone: 'Asia/Shanghai',
        },
      });

      record = await getRecord(table.id, recordId);
      expect(record.data.fields[workdayField.name]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

      const record = await getRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Name,
      });
      expect(record.data.fields[table.fields[0].name]).toEqual('1');
    });
  });
});
