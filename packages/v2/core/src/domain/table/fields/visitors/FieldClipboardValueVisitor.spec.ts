import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { AttachmentField } from '../types/AttachmentField';
import { DateField } from '../types/DateField';
import { DateTimeFormatting } from '../types/DateTimeFormatting';
import { MultipleSelectField } from '../types/MultipleSelectField';
import { NumberField } from '../types/NumberField';
import { NumberFormatting } from '../types/NumberFormatting';
import { UserField } from '../types/UserField';
import { UserMultiplicity } from '../types/UserMultiplicity';
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
