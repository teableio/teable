import { describe, expect, it } from 'vitest';

import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { AttachmentField } from '../../domain/table/fields/types/AttachmentField';
import { CellValueMultiplicity } from '../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../domain/table/fields/types/CellValueType';
import { DateField } from '../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../domain/table/fields/types/FormulaField';
import { LookupField } from '../../domain/table/fields/types/LookupField';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../domain/table/fields/types/NumberFormatting';
import { UserField } from '../../domain/table/fields/types/UserField';
import { UserMultiplicity } from '../../domain/table/fields/types/UserMultiplicity';
import { FieldClipboardValueVisitor, stringifyClipboardRows } from './FieldClipboardValueVisitor';

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (value: string) => FieldName.create(value)._unsafeUnwrap();

describe('FieldClipboardValueVisitor', () => {
  it('formats decimal, percent and currency values with v1-compatible precision', () => {
    const decimal = NumberField.create({
      id: fieldId('a'),
      name: fieldName('Decimal'),
      formatting: NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const percent = NumberField.create({
      id: fieldId('b'),
      name: fieldName('Percent'),
      formatting: NumberFormatting.create({ type: 'percent', precision: 1 })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const currency = NumberField.create({
      id: fieldId('c'),
      name: fieldName('Currency'),
      formatting: NumberFormatting.create({
        type: 'currency',
        precision: 2,
        symbol: '$',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    expect(decimal.accept(new FieldClipboardValueVisitor(1.234))._unsafeUnwrap()).toBe('1.23');
    expect(percent.accept(new FieldClipboardValueVisitor(0.126))._unsafeUnwrap()).toBe('12.6%');
    expect(currency.accept(new FieldClipboardValueVisitor(-1234.5))._unsafeUnwrap()).toBe(
      '-$1,234.50'
    );
    expect(decimal.accept(new FieldClipboardValueVisitor(null))._unsafeUnwrap()).toBe('');
  });

  it('copies numbers beyond safe integers with the digits the API returns', () => {
    const decimal = NumberField.create({
      id: fieldId('a'),
      name: fieldName('Decimal'),
      formatting: NumberFormatting.create({ type: 'decimal', precision: 2 })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const integer = NumberField.create({
      id: fieldId('b'),
      name: fieldName('Integer'),
      formatting: NumberFormatting.create({ type: 'decimal', precision: 0 })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const num = 22800101040067320000;

    expect(decimal.accept(new FieldClipboardValueVisitor(num))._unsafeUnwrap()).toBe(
      '22800101040067320000.00'
    );
    expect(integer.accept(new FieldClipboardValueVisitor(num))._unsafeUnwrap()).toBe(String(num));
    expect(decimal.accept(new FieldClipboardValueVisitor(1e21))._unsafeUnwrap()).toBe('1e+21');
  });

  it('formats dates in the Field timezone and selected display pattern', () => {
    const field = DateField.create({
      id: fieldId('d'),
      name: fieldName('Date'),
      formatting: DateTimeFormatting.create({
        date: 'YYYY/MM/DD',
        time: 'HH:mm',
        timeZone: 'Asia/Singapore',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    expect(
      field.accept(new FieldClipboardValueVisitor('2023-06-19T06:50:48.017Z'))._unsafeUnwrap()
    ).toBe('2023/06/19 14:50');
  });

  it.each([
    ['YYYY-MMM-DD', '2023-Jul-12'],
    [
      'YY YYYY M MM MMM MMMM D DD d dd ddd dddd H HH h hh m mm s ss SSS Z ZZ A a',
      '23 2023 7 07 Jul July 12 12 3 We Wed Wednesday 13 13 1 01 4 04 5 05 006 +00:00 +0000 PM pm',
    ],
    ['[YYYY MMMM D HH:mm:ss.SSS Z A] YYYY-MMM-DD', 'YYYY MMMM D HH:mm:ss.SSS Z A 2023-Jul-12'],
  ])('formats the complete standard date pattern %s', (pattern, expected) => {
    const field = DateField.create({
      id: fieldId('h'),
      name: fieldName('Custom date'),
      formatting: DateTimeFormatting.create({
        date: pattern,
        time: 'None',
        timeZone: 'UTC',
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    expect(
      field.accept(new FieldClipboardValueVisitor('2023-07-12T13:04:05.006Z'))._unsafeUnwrap()
    ).toBe(expected);
  });

  it.each([
    [
      'America/Los_Angeles',
      '2024-01-01T00:04:05.006Z',
      '2023-12-31 Sunday 16:04:05.006 -08:00 -0800',
    ],
    ['America/New_York', '2024-03-10T06:59:07.009Z', '2024-03-10 Sunday 01:59:07.009 -05:00 -0500'],
    ['America/New_York', '2024-03-10T07:01:08.010Z', '2024-03-10 Sunday 03:01:08.010 -04:00 -0400'],
  ])('preserves rollover and DST in %s at %s', (timeZone, value, expected) => {
    const field = DateField.create({
      id: fieldId('i'),
      name: fieldName('Zoned date'),
      formatting: DateTimeFormatting.create({
        date: 'YYYY-MM-DD dddd HH:mm:ss.SSS Z ZZ',
        time: 'None',
        timeZone,
      })._unsafeUnwrap(),
    })._unsafeUnwrap();

    expect(field.accept(new FieldClipboardValueVisitor(value))._unsafeUnwrap()).toBe(expected);
  });

  it('formats computed and lookup date arrays with their field formatting', () => {
    const formatting = DateTimeFormatting.create({
      date: 'ddd, MMMM D YYYY HH:mm:ss.SSS Z',
      time: 'None',
      timeZone: 'America/New_York',
    })._unsafeUnwrap();
    const date = DateField.create({
      id: fieldId('j'),
      name: fieldName('Date'),
      formatting,
    })._unsafeUnwrap();
    const formula = FormulaField.create({
      id: fieldId('k'),
      name: fieldName('Computed dates'),
      expression: FormulaExpression.create('NOW()')._unsafeUnwrap(),
      formatting,
      resultType: {
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.multiple(),
      },
    })._unsafeUnwrap();
    const lookups = [date, formula].map((innerField, index) =>
      LookupField.create({
        id: fieldId(index === 0 ? 'l' : 'm'),
        name: fieldName('Lookup dates'),
        innerField,
        isMultipleCellValue: true,
        lookupOptions: LookupOptions.create({
          linkFieldId: fieldId('n').toString(),
          foreignTableId: `tbl${'o'.repeat(16)}`,
          lookupFieldId: innerField.id().toString(),
        })._unsafeUnwrap(),
      })._unsafeUnwrap()
    );

    for (const field of [formula, ...lookups]) {
      expect(
        field
          .accept(
            new FieldClipboardValueVisitor([
              '2024-01-01T12:04:05.006Z',
              null,
              '2024-07-01T12:04:05.006Z',
            ])
          )
          ._unsafeUnwrap()
      ).toBe('Mon, January 1 2024 07:04:05.006 -05:00, , Mon, July 1 2024 08:04:05.006 -04:00');
    }
  });

  it('keeps null dates empty and invalid dates unchanged', () => {
    const field = DateField.create({
      id: fieldId('p'),
      name: fieldName('Date'),
    })._unsafeUnwrap();

    expect(field.accept(new FieldClipboardValueVisitor(null))._unsafeUnwrap()).toBe('');
    expect(field.accept(new FieldClipboardValueVisitor(undefined))._unsafeUnwrap()).toBe('');
    expect(field.accept(new FieldClipboardValueVisitor('not-a-date'))._unsafeUnwrap()).toBe(
      'not-a-date'
    );
  });

  it('formats multiple select, user and attachment structured values', () => {
    const select = MultipleSelectField.create({
      id: fieldId('e'),
      name: fieldName('Tags'),
      options: [],
    })._unsafeUnwrap();
    const user = UserField.create({
      id: fieldId('f'),
      name: fieldName('Owners'),
      isMultiple: UserMultiplicity.multiple(),
    })._unsafeUnwrap();
    const attachment = AttachmentField.create({
      id: fieldId('g'),
      name: fieldName('Files'),
    })._unsafeUnwrap();

    expect(
      select.accept(new FieldClipboardValueVisitor(['Alpha, Beta', 'Gamma']))._unsafeUnwrap()
    ).toBe('"Alpha, Beta", Gamma');
    expect(
      user
        .accept(
          new FieldClipboardValueVisitor([
            { id: 'usr1', title: 'Doe, Jane' },
            { id: 'usr2', title: 'Alex' },
          ])
        )
        ._unsafeUnwrap()
    ).toBe('"Doe, Jane", Alex');
    expect(
      attachment
        .accept(
          new FieldClipboardValueVisitor([
            { name: 'a.txt', token: 'tok1' },
            { name: 'b.png', token: 'tok2' },
          ])
        )
        ._unsafeUnwrap()
    ).toBe('a.txt (tok1),b.png (tok2)');
  });

  it('serializes TSV cells with tab, newline and quote escaping', () => {
    expect(
      stringifyClipboardRows([
        ['plain', 'with\ttab'],
        ['line\nbreak', 'say "hello"'],
      ])
    ).toBe('plain\t"with\ttab"\n"line\nbreak"\tsay "hello"');
    expect(stringifyClipboardRows([['a"b\nc']])).toBe('"a""b\nc"');
  });
});
