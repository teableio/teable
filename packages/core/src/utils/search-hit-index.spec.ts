import { plainToInstance } from 'class-transformer';
import { describe, expect, it } from 'vitest';
import { Colors } from '../models/field/colors';
import { CellValueType, DbFieldType, FieldType } from '../models/field/constant';
import { AttachmentFieldCore } from '../models/field/derivate/attachment.field';
import { ButtonFieldCore } from '../models/field/derivate/button.field';
import { CheckboxFieldCore } from '../models/field/derivate/checkbox.field';
import { DateFieldCore } from '../models/field/derivate/date.field';
import { FormulaFieldCore } from '../models/field/derivate/formula.field';
import { MultipleSelectFieldCore } from '../models/field/derivate/multiple-select.field';
import { NumberFieldCore } from '../models/field/derivate/number.field';
import { SingleLineTextFieldCore } from '../models/field/derivate/single-line-text.field';
import { NumberFormattingType, TimeFormatting } from '../models/field/formatting';
import { computeSearchHitIndex } from './search-hit-index';

const textField = plainToInstance(SingleLineTextFieldCore, {
  id: 'fldText000000000001',
  name: 'Name',
  dbFieldName: 'Name',
  type: FieldType.SingleLineText,
  options: {},
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
});

const numberField = plainToInstance(NumberFieldCore, {
  id: 'fldNumber0000000001',
  name: 'Amount',
  dbFieldName: 'Amount',
  type: FieldType.Number,
  options: { formatting: { type: NumberFormattingType.Decimal, precision: 2 } },
  cellValueType: CellValueType.Number,
  dbFieldType: DbFieldType.Real,
});

const checkboxField = plainToInstance(CheckboxFieldCore, {
  id: 'fldCheckbox00000001',
  name: 'Done',
  dbFieldName: 'Done',
  type: FieldType.Checkbox,
  options: {},
  cellValueType: CellValueType.Boolean,
  dbFieldType: DbFieldType.Boolean,
});

const buttonField = plainToInstance(ButtonFieldCore, {
  id: 'fldButton0000000001',
  name: 'Run',
  dbFieldName: 'Run',
  type: FieldType.Button,
  options: { label: 'Run task', color: Colors.Teal },
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
});

const dateField = plainToInstance(DateFieldCore, {
  id: 'fldDate0000000000001',
  name: 'Due',
  dbFieldName: 'Due',
  type: FieldType.Date,
  options: {
    formatting: { date: 'YYYY-MM-DD', time: TimeFormatting.None, timeZone: 'utc' },
  },
  cellValueType: CellValueType.DateTime,
  dbFieldType: DbFieldType.DateTime,
});

const fields = [textField, numberField, checkboxField, buttonField, dateField];

const records = [
  {
    id: 'recA000000000000001',
    fields: {
      [textField.id]: 'Hello World',
      [numberField.id]: 1.5,
      [checkboxField.id]: true,
      [dateField.id]: '2026-01-15T00:00:00.000Z',
    },
  },
  {
    id: 'recB000000000000001',
    fields: {
      [textField.id]: 'true story',
      [numberField.id]: null,
    },
  },
];

describe('computeSearchHitIndex', () => {
  it('returns undefined without a search value', () => {
    expect(computeSearchHitIndex(records, fields, undefined)).toBeUndefined();
    expect(computeSearchHitIndex(records, fields, ['', '', false])).toBeUndefined();
  });

  it('matches case-insensitively across all searchable fields', () => {
    expect(computeSearchHitIndex(records, fields, ['hello', '', false])).toEqual([
      { recordId: 'recA000000000000001', fieldId: textField.id },
    ]);
  });

  it('matches numbers by their formatted display text', () => {
    expect(computeSearchHitIndex(records, fields, ['1.50', '', false])).toEqual([
      { recordId: 'recA000000000000001', fieldId: numberField.id },
    ]);
  });

  it('scopes matching to comma-separated field ids', () => {
    const scoped = computeSearchHitIndex(records, fields, [
      'o',
      `${numberField.id},${checkboxField.id}`,
      false,
    ]);
    expect(scoped).toBeUndefined();

    const textScoped = computeSearchHitIndex(records, fields, ['o', textField.id, false]);
    expect(textScoped).toEqual([
      { recordId: 'recA000000000000001', fieldId: textField.id },
      { recordId: 'recB000000000000001', fieldId: textField.id },
    ]);
  });

  it('never matches attachment fields', () => {
    const filesField = plainToInstance(AttachmentFieldCore, {
      id: 'fldFiles00000000001',
      name: 'Files',
      dbFieldName: 'Files',
      type: FieldType.Attachment,
      options: {},
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Json,
    });
    const cellValue = [
      {
        id: 'act1',
        name: 'invoice.txt',
        token: 'tok123',
        size: 1,
        mimetype: 'text/plain',
        path: '',
      },
    ];
    expect(filesField.matchSearch(cellValue, 'invoice', {})).toBe(false);
  });

  it('never matches checkbox or button fields and skips null cell values', () => {
    expect(computeSearchHitIndex(records, fields, ['true', '', false])).toEqual([
      { recordId: 'recB000000000000001', fieldId: textField.id },
    ]);
    expect(
      computeSearchHitIndex(
        [{ id: 'recC000000000000001', fields: { [buttonField.id]: 'Run task' } }],
        fields,
        ['run', '', false]
      )
    ).toBeUndefined();
  });

  it('skips datetime fields for all-fields search but matches them when scoped', () => {
    expect(computeSearchHitIndex(records, fields, ['2026', '', false])).toBeUndefined();
    expect(computeSearchHitIndex(records, fields, ['2026', dateField.id, false])).toEqual([
      { recordId: 'recA000000000000001', fieldId: dateField.id },
    ]);
  });

  it('skips number fields for a non-numeric all-fields search but not when scoped', () => {
    // '1.50' contains '.', but Number('.') is NaN so all-fields search skips it
    expect(computeSearchHitIndex(records, fields, ['.', '', false])).toBeUndefined();
    expect(computeSearchHitIndex(records, fields, ['.', numberField.id, false])).toEqual([
      { recordId: 'recA000000000000001', fieldId: numberField.id },
    ]);
  });

  it('returns undefined when nothing matches', () => {
    expect(computeSearchHitIndex(records, fields, ['zzz', '', false])).toBeUndefined();
  });

  // multi-value cells match per item: the joined display text 'alpha, beta'
  // must not match across element boundaries, mirroring backend SQL
  it('matches multi-value cells per item, not across the joined text', () => {
    const tagsField = plainToInstance(MultipleSelectFieldCore, {
      id: 'fldTags000000000001',
      name: 'Tags',
      dbFieldName: 'Tags',
      type: FieldType.MultipleSelect,
      options: { choices: [{ name: 'alpha' }, { name: 'beta' }] },
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Json,
    });
    expect(tagsField.matchSearch(['alpha', 'beta'], 'alpha', {})).toBe(true);
    expect(tagsField.matchSearch(['alpha', 'beta'], 'a, b', {})).toBe(false);
  });

  // computed fields must follow the rules of their result cellValueType, not
  // of their field class — keyed on cellValueType in FieldCore.matchSearch
  it('applies cellValueType rules to computed fields', () => {
    const dateFormula = plainToInstance(FormulaFieldCore, {
      id: 'fldFormulaDate00001',
      name: 'Computed Due',
      dbFieldName: 'ComputedDue',
      type: FieldType.Formula,
      options: { expression: `{${dateField.id}}` },
      cellValueType: CellValueType.DateTime,
      dbFieldType: DbFieldType.DateTime,
      isComputed: true,
    });
    const isoDate = '2026-01-15T00:00:00.000Z';
    expect(dateFormula.matchSearch(isoDate, '2026', { isSearchAllFields: true })).toBe(false);

    const booleanFormula = plainToInstance(FormulaFieldCore, {
      ...dateFormula,
      id: 'fldFormulaBool00001',
      cellValueType: CellValueType.Boolean,
      dbFieldType: DbFieldType.Boolean,
    });
    expect(booleanFormula.matchSearch(true, 'true', {})).toBe(false);
  });
});
