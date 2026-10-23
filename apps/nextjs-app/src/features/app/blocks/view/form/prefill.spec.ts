import {
  CellValueType,
  DbFieldType,
  FieldType,
  NumberFormattingType,
  TimeFormatting,
} from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { createFieldInstance } from '@teable/sdk/model';
import type { IFieldInstance } from '@teable/sdk/model';
import { getFormPrefillValues } from './prefill';

const buildField = (
  type: FieldType,
  id: string,
  extra: Record<string, unknown> = {}
): IFieldInstance =>
  createFieldInstance({
    id,
    name: id,
    dbFieldName: id,
    type,
    cellValueType: CellValueType.String,
    dbFieldType: DbFieldType.Text,
    options: {},
    ...extra,
  } as IFieldVo);

const textField = buildField(FieldType.SingleLineText, 'fldText');
const longTextField = buildField(FieldType.LongText, 'fldLongText');
const numberField = buildField(FieldType.Number, 'fldNumber', {
  options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
});
const percentField = buildField(FieldType.Number, 'fldPercent', {
  options: { formatting: { type: NumberFormattingType.Percent, precision: 2 } },
});
const departmentField = buildField(FieldType.SingleSelect, 'fldDepartment', {
  options: {
    choices: [
      { id: 'choSales', name: 'Sales', color: 'blue' },
      { id: 'choOps', name: 'Ops', color: 'green' },
    ],
  },
});
const tagsField = buildField(FieldType.MultipleSelect, 'fldTags', {
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: true,
  options: {
    choices: [
      { id: 'choSales', name: 'Sales', color: 'blue' },
      { id: 'choOps', name: 'Ops', color: 'green' },
      { id: 'choSalesUs', name: 'Sales, US', color: 'orangeBright' },
    ],
  },
});
const checkboxField = buildField(FieldType.Checkbox, 'fldCheckbox', {
  cellValueType: CellValueType.Boolean,
  dbFieldType: DbFieldType.Boolean,
});
const dateField = buildField(FieldType.Date, 'fldDate', {
  cellValueType: CellValueType.DateTime,
  dbFieldType: DbFieldType.DateTime,
  options: {
    formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.None, timeZone: 'Asia/Shanghai' },
  },
});
const ratingField = buildField(FieldType.Rating, 'fldRating', {
  cellValueType: CellValueType.Number,
  dbFieldType: DbFieldType.Integer,
  options: { icon: 'star', color: 'yellowBright', max: 5 },
});
const userField = buildField(FieldType.User, 'fldUser', {
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: true,
  options: { isMultiple: true, shouldNotify: false },
});
const linkField = buildField(FieldType.Link, 'fldLink', {
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: true,
  options: {},
});
const attachmentField = buildField(FieldType.Attachment, 'fldAttachment', {
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: true,
});
const buttonField = buildField(FieldType.Button, 'fldButton', {
  dbFieldType: DbFieldType.Json,
});
const computedField = {
  id: 'fldComputed',
  type: FieldType.Formula,
  isComputed: true,
  isLookup: false,
  options: {},
} as unknown as IFieldInstance;
const lookupField = {
  id: 'fldLookup',
  type: FieldType.SingleLineText,
  isComputed: false,
  isLookup: true,
  options: {},
} as unknown as IFieldInstance;

describe('getFormPrefillValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads text, long text, number and single select params', () => {
    expect(
      getFormPrefillValues([textField, longTextField, numberField, departmentField], {
        fldText: 'Acme',
        fldLongText: 'line one\nline two',
        fldNumber: '42.5',
        fldDepartment: 'Sales',
        shareId: 'shrIgnored',
        embed: 'true',
      })
    ).toStrictEqual({
      fldText: 'Acme',
      fldLongText: 'line one\nline two',
      fldNumber: 42.5,
      fldDepartment: 'Sales',
    });
  });

  it('reads multiple select, checkbox, date and rating params', () => {
    expect(
      getFormPrefillValues([tagsField, checkboxField, dateField, ratingField], {
        fldTags: 'Sales,Ops',
        fldCheckbox: 'true',
        fldDate: '2026-10-22',
        fldRating: '4.6',
      })
    ).toStrictEqual({
      fldTags: ['Sales', 'Ops'],
      fldCheckbox: true,
      fldDate: '2026-10-21T16:00:00.000Z',
      fldRating: 5,
    });
  });

  it('joins repeated params for a multiple select and keeps only existing options', () => {
    expect(
      getFormPrefillValues([tagsField], { fldTags: ['Sales', 'Ops', 'Unknown'] })
    ).toStrictEqual({ fldTags: ['Sales', 'Ops'] });
    expect(getFormPrefillValues([tagsField], { fldTags: ['Sales, US', 'Ops'] })).toStrictEqual({
      fldTags: ['Sales, US', 'Ops'],
    });
    expect(getFormPrefillValues([tagsField], { fldTags: ['"Sales, US"', 'Ops'] })).toStrictEqual({
      fldTags: ['Sales, US', 'Ops'],
    });
  });

  it('reads structured user, link and attachment values as JSON', () => {
    expect(
      getFormPrefillValues([userField, linkField, attachmentField], {
        fldUser: JSON.stringify([{ id: 'usrFixture', title: 'Nee', email: 'nee@teable.ai' }]),
        fldLink: JSON.stringify([{ id: 'recLinked000000001', title: 'Linked' }]),
        fldAttachment: JSON.stringify([
          {
            id: 'actFixture00000001',
            name: 'proof.png',
            path: 'table/tokFixture',
            token: 'tokFixture',
            size: 1234,
            mimetype: 'image/png',
            presignedUrl: 'https://example.test/proof.png',
          },
        ]),
      })
    ).toStrictEqual({
      fldUser: [{ id: 'usrFixture', title: 'Nee', email: 'nee@teable.ai' }],
      fldLink: [{ id: 'recLinked000000001', title: 'Linked' }],
      fldAttachment: [
        {
          id: 'actFixture00000001',
          name: 'proof.png',
          path: 'table/tokFixture',
          token: 'tokFixture',
          size: 1234,
          mimetype: 'image/png',
          presignedUrl: 'https://example.test/proof.png',
        },
      ],
    });
  });

  it('drops malformed structured values instead of filling the cell', () => {
    expect(getFormPrefillValues([userField], { fldUser: 'not json' })).toStrictEqual({});
    expect(getFormPrefillValues([userField], { fldUser: '[]' })).toStrictEqual({});
    expect(
      getFormPrefillValues([linkField], { fldLink: JSON.stringify([{ id: 'not-a-record' }]) })
    ).toStrictEqual({});
    expect(
      getFormPrefillValues([attachmentField], { fldAttachment: JSON.stringify([{}]) })
    ).toStrictEqual({});
    expect(
      getFormPrefillValues([attachmentField], {
        fldAttachment: JSON.stringify([{ name: 'proof.png', token: 'tokFixture' }]),
      })
    ).toStrictEqual({});
  });

  it('drops button and computed or lookup fields', () => {
    expect(
      getFormPrefillValues([buttonField, computedField, lookupField], {
        fldButton: 'click',
        fldComputed: 'computed',
        fldLookup: 'lookup',
      })
    ).toStrictEqual({});
  });

  it('ignores invalid numbers, select options, dates and ratings', () => {
    expect(getFormPrefillValues([numberField], { fldNumber: '12abc' })).toStrictEqual({});
    expect(getFormPrefillValues([numberField], { fldNumber: 'Infinity' })).toStrictEqual({});
    expect(getFormPrefillValues([numberField], { fldNumber: '0x10' })).toStrictEqual({});
    expect(getFormPrefillValues([numberField], { fldNumber: ' ' })).toStrictEqual({});
    expect(getFormPrefillValues([departmentField], { fldDepartment: 'Unknown' })).toStrictEqual({});
    expect(getFormPrefillValues([departmentField], { fldDepartment: 'choSales' })).toStrictEqual(
      {}
    );
    expect(getFormPrefillValues([dateField], { fldDate: 'not-a-date' })).toStrictEqual({});
    expect(getFormPrefillValues([ratingField], { fldRating: 'abc' })).toStrictEqual({});
    expect(getFormPrefillValues([ratingField], { fldRating: '0' })).toStrictEqual({});
    expect(getFormPrefillValues([ratingField], { fldRating: '-2' })).toStrictEqual({});
  });

  it('treats a false checkbox as empty and accepts only known true forms', () => {
    expect(getFormPrefillValues([checkboxField], { fldCheckbox: 'false' })).toStrictEqual({});
    expect(getFormPrefillValues([checkboxField], { fldCheckbox: '0' })).toStrictEqual({});
    expect(getFormPrefillValues([checkboxField], { fldCheckbox: 'constructor' })).toStrictEqual({});
    expect(getFormPrefillValues([checkboxField], { fldCheckbox: '__proto__' })).toStrictEqual({});
    expect(getFormPrefillValues([checkboxField], { fldCheckbox: '1' })).toStrictEqual({
      fldCheckbox: true,
    });
  });

  it('parses a percent-formatted number the same way the field editor does', () => {
    expect(getFormPrefillValues([percentField], { fldPercent: '42' })).toStrictEqual({
      fldPercent: 0.42,
    });
    expect(getFormPrefillValues([percentField], { fldPercent: '42%' })).toStrictEqual({
      fldPercent: 0.42,
    });
  });

  it('keeps the sign of a negative leading-dot decimal and rejects overflow', () => {
    expect(getFormPrefillValues([numberField], { fldNumber: '-.5' })).toStrictEqual({
      fldNumber: -0.5,
    });
    expect(getFormPrefillValues([numberField], { fldNumber: '9'.repeat(400) })).toStrictEqual({});
  });

  it('skips empty params and uses the first value of a repeated text param', () => {
    expect(getFormPrefillValues([textField], { fldText: '' })).toStrictEqual({});
    expect(getFormPrefillValues([textField], { fldText: ['first', 'second'] })).toStrictEqual({
      fldText: 'first',
    });
  });
});
