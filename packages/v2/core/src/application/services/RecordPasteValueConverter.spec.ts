import { describe, expect, it, vi } from 'vitest';

import type { TemporaryPasteSourceField } from '../../commands/TemporaryPasteCommand';
import type { Field } from '../../domain/table/fields/Field';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITableFieldPersistenceDTO } from '../../ports/mappers/TableMapper';
import { FieldClipboardValueVisitor } from '../formatting/FieldClipboardValueVisitor';
import {
  normalizeRecordLinkPasteValue,
  prepareRecordPasteValueConverter,
} from './RecordPasteValueConverter';

const fieldId = (seed: string) => `fld${seed.repeat(16)}`;
const tableId = (seed: string) => `tbl${seed.repeat(16)}`;
const mapper = new DefaultTableMapper();
const target = (dto: ITableFieldPersistenceDTO) => mapper.fieldFromDTO(dto)._unsafeUnwrap();
const text = () => target({ id: fieldId('a'), name: 'Text', type: 'singleLineText' });
const convert = (field: Field, header: TemporaryPasteSourceField, value: unknown) =>
  prepareRecordPasteValueConverter(field, header)._unsafeUnwrap()(value)._unsafeUnwrap();
const select = (multiple: boolean) =>
  target({
    id: fieldId('b'),
    name: 'Choices',
    type: multiple ? 'multipleSelect' : 'singleSelect',
    options: { choices: [] },
  });
const user = (multiple: boolean) =>
  target({
    id: fieldId('c'),
    name: 'Owners',
    type: 'user',
    options: { isMultiple: multiple },
  });
const linkOptions = (foreignTableId: string) => ({
  foreignTableId,
  lookupFieldId: fieldId('d'),
  relationship: 'manyMany' as const,
});
const linkHeader = (foreignTableId: string): TemporaryPasteSourceField => ({
  type: 'link',
  options: linkOptions(foreignTableId),
});
const dateHeader: TemporaryPasteSourceField = {
  type: 'date',
  isLookup: true,
  isMultipleCellValue: true,
  options: { formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Tokyo' } },
};
const date = () => target({ id: fieldId('e'), name: 'Date', type: 'date' });

describe('ordinary record paste value preparation', () => {
  it('formats typed percent values and numeric strings through one prepared converter', () => {
    const converter = prepareRecordPasteValueConverter(text(), {
      type: 'number',
      options: { formatting: { type: 'percent', precision: 1 } },
    })._unsafeUnwrap();
    expect(converter(0.25)._unsafeUnwrap()).toBe('25.0%');
    expect(converter('0.25')._unsafeUnwrap()).toBe('25.0%');
    expect(converter(null)._unsafeUnwrap()).toBeNull();
    expect(converter(undefined)._unsafeUnwrap()).toBeNull();
  });

  it('uses display semantics, not clipboard coercion, for malformed scalar text and number arrays', () => {
    const values = ['Alpha', 'Beta'];
    const historical = { title: 'Historical text object' };
    const textHeader = { type: 'singleLineText' };
    expect(convert(text(), textHeader, values)).toBe(values);
    expect(convert(text(), textHeader, historical)).toBe(historical);
    expect(convert(text(), textHeader, 42)).toBe(42);
    expect(convert(text(), { ...textHeader, isMultipleCellValue: true }, values)).toBe(
      'Alpha, Beta'
    );
    expect(text().accept(new FieldClipboardValueVisitor(values))._unsafeUnwrap()).toBe(
      'Alpha, Beta'
    );

    const numberOptions = { formatting: { type: 'decimal' as const, precision: 1 } };
    const numberHeader: TemporaryPasteSourceField = {
      type: 'number',
      options: numberOptions,
    };
    const number = target({
      id: fieldId('f'),
      name: 'Number',
      type: 'number',
      options: numberOptions,
    });
    expect(convert(text(), numberHeader, [1, 2])).toBe('NaN');
    expect(number.accept(new FieldClipboardValueVisitor([1, 2]))._unsafeUnwrap()).toBe('1.0, 2.0');
    expect(convert(text(), { ...numberHeader, isMultipleCellValue: true }, [1, 2])).toBe(
      '1.0, 2.0'
    );
  });

  it('takes the first raw Date entry without flattening, including empty and nested arrays', () => {
    const values = ['2023-06-19T06:50:48.017Z', '2023-06-20T06:50:48.017Z'];
    expect(convert(date(), dateHeader, values)).toBe(values[0]);
    expect(convert(date(), dateHeader, [values])).toBe(values);
    expect(convert(date(), dateHeader, [])).toBeUndefined();
    expect(convert(date(), dateHeader, [null, values[0]])).toBeNull();
  });

  it('parses the first rendered date prefix in the source timezone and retains fallback segments', () => {
    expect(convert(date(), dateHeader, '2023/06/19 15:50, 2023/06/20 15:50')).toBe(
      '2023-06-19T06:50:00.000Z'
    );
    expect(
      convert(
        date(),
        {
          ...dateHeader,
          options: { formatting: { date: 'DD, MM/YYYY', time: 'HH:mm', timeZone: 'Asia/Tokyo' } },
        },
        '19, 06/2023 15:50, 20, 06/2023 15:50'
      )
    ).toBe('2023-06-19T06:50:00.000Z');
    expect(convert(date(), dateHeader, ' , invalid first , invalid second , ')).toBe(
      'invalid first'
    );
    expect(convert(date(), dateHeader, '  invalid single  , ,')).toBe('  invalid single  , ,');
    expect(convert(date(), { ...dateHeader, isMultipleCellValue: false }, 'bad, second')).toBe(
      'bad, second'
    );
  });

  it.each([
    ['2024-03-10 03:30, 2024-03-11 03:30', '2024-03-10T07:30:00.000Z'],
    ['2024-11-03 02:30, 2024-11-04 02:30', '2024-11-03T07:30:00.000Z'],
  ])(
    'resolves source-local DST transitions for the first rendered date (%s)',
    (value, expected) => {
      expect(
        convert(
          date(),
          {
            ...dateHeader,
            options: {
              formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'America/New_York' },
            },
          },
          value
        )
      ).toBe(expected);
    }
  );

  it.each([
    ['MM-DD', '06-19, 06-20', '2026-06-19T04:00:00.000Z'],
    ['MM', '06, 07', '2026-06-01T04:00:00.000Z'],
    ['DD', '19, 20', '2026-02-19T05:00:00.000Z'],
  ])(
    'uses current calendar defaults for yearless source date presets (%s)',
    (format, value, expected) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'));
      try {
        expect(
          convert(
            date(),
            {
              ...dateHeader,
              options: {
                formatting: { date: format, time: 'None', timeZone: 'America/New_York' },
              },
            },
            value
          )
        ).toBe(expected);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('preserves already-rendered datetime strings but source-formats absolute ISO values', () => {
    const rendered = ' 2023/06/19 15:50, 2023/06/20 15:50 ';
    expect(convert(text(), dateHeader, rendered)).toBe(rendered);
    expect(convert(text(), dateHeader, '2023-06-19T06:50:48.017Z')).toBe('2023/06/19 15:50');
    expect(convert(text(), dateHeader, '2023-06-19T14:50:48.017+08:00')).toBe('2023/06/19 15:50');
    expect(
      convert(text(), dateHeader, ['2023-06-19T06:50:48.017Z', '2023-06-20T06:50:48.017Z'])
    ).toBe('2023/06/19 15:50, 2023/06/20 15:50');
    expect(
      convert(
        text(),
        {
          type: 'formula',
          options: {
            expression: 'NOW()',
            formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Tokyo' },
          },
          cellValueType: 'dateTime',
          isMultipleCellValue: false,
        },
        '2023-06-19T06:50:48.017Z'
      )
    ).toBe('2023/06/19 15:50');
  });

  it('preserves select choice boundaries, first-item undefined and malformed scalar values', () => {
    const header: TemporaryPasteSourceField = { type: 'multipleSelect', options: { choices: [] } };
    const values = [['A,B'], ['C']];
    expect(convert(select(true), header, values)).toEqual(['A,B', 'C']);
    expect(convert(select(false), header, values)).toBe('A,B');
    expect(convert(select(false), header, [])).toBeUndefined();
    expect(convert(select(false), header, [null, 'C'])).toBeNull();
    expect(convert(select(true), header, '"A,B",C')).toBe('"A,B",C');
    expect(convert(select(true), header, '')).toBe('');
    expect(convert(select(false), header, false)).toBe(false);
    expect(convert(text(), header, ['A,B', null, 'C'])).toBe('"A,B", , C');
    expect(convert(text(), { type: 'singleSelect', options: { choices: [] } }, ['A,B', 'C'])).toBe(
      'A,B, C'
    );
  });

  it('preserves identity nesting and applies existing user and attachment cardinality', () => {
    const users = [
      { id: 'usrA', title: 'Alice' },
      { id: 'usrB', title: 'Bob' },
    ];
    const header: TemporaryPasteSourceField = {
      type: 'user',
      options: { isMultiple: true },
      isLookup: true,
      isMultipleCellValue: true,
    };
    expect(convert(user(true), header, [users])).toEqual([users]);
    expect(convert(user(false), header, [users])).toBe(users);
    expect(convert(user(true), header, users)).toEqual(users);
    expect(convert(user(false), header, users)).toBe(users[0]);
    expect(convert(user(false), header, [])).toBeUndefined();
    expect(convert(user(false), header, [null, users[0]])).toBeNull();
    expect(convert(user(true), header, users[0])).toEqual([users[0]]);
    const files = [
      { name: 'a.txt', token: 'token-a' },
      { name: 'b.txt', token: 'token-b' },
    ];
    const attachment = target({ id: fieldId('g'), name: 'Files', type: 'attachment' });
    const attachmentHeader = { type: 'attachment', isMultipleCellValue: true };
    expect(convert(attachment, attachmentHeader, [files])).toEqual([files]);
    expect(convert(attachment, attachmentHeader, files[0])).toEqual([files[0]]);
    expect(convert(attachment, attachmentHeader, [])).toEqual([]);
    expect(convert(attachment, { type: 'singleLineText' }, 'a.txt')).toBe('a.txt');
  });

  it('preserves ordinary link identities even when source and target foreign tables differ', () => {
    const link = target({
      id: fieldId('h'),
      name: 'Link',
      type: 'link',
      options: linkOptions(tableId('i')),
    });
    const values = Object.freeze([{ id: ' recAlpha ', title: 'Alpha, Beta' }]);
    expect(convert(link, linkHeader(tableId('j')), values)).toEqual([
      { id: 'recAlpha', title: 'Alpha, Beta' },
    ]);
    expect(values[0]?.id).toBe(' recAlpha ');
    expect(
      convert(link, linkHeader(tableId('i')), [' Alpha ', { id: ' recBeta ', title: 'Beta' }])
    ).toBe('Alpha,recBeta');
    expect(
      convert(
        link,
        { type: 'number', options: { formatting: { type: 'percent', precision: 0 } } },
        '0.25'
      )
    ).toBe('25%');
  });

  it('bypasses computed targets before source hydration and preserves the exact incoming value', () => {
    const computed = target({
      id: fieldId('k'),
      name: 'Computed',
      type: 'formula',
      options: { expression: '1 + 1' },
    });
    const converter = prepareRecordPasteValueConverter(computed, {
      type: 'link',
      options: {},
    })._unsafeUnwrap();
    const value = { invalid: 'source metadata is irrelevant to computed targets' };
    expect(converter(value)._unsafeUnwrap()).toBe(value);
    expect(converter(undefined)._unsafeUnwrap()).toBeUndefined();
  });

  it('returns explicit errors for malformed metadata and serialization, not success-empty values', () => {
    expect(prepareRecordPasteValueConverter(text(), { type: 'link', options: {} }).isErr()).toBe(
      true
    );
    const attachments = prepareRecordPasteValueConverter(text(), {
      type: 'attachment',
    })._unsafeUnwrap();
    expect(attachments({ name: 'scalar instead of array' })._unsafeUnwrapErr().code).toBe(
      'formatting.invalid_cell_value'
    );
    const dates = prepareRecordPasteValueConverter(text(), dateHeader)._unsafeUnwrap();
    expect(dates(['not a date']).isErr()).toBe(true);
    const numbers = prepareRecordPasteValueConverter(text(), { type: 'number' })._unsafeUnwrap();
    expect(numbers(Symbol('not numeric')).isErr()).toBe(true);
  });
});

describe('ordinary record link paste normalization', () => {
  it('retains string titles only for structured items and obeys scalar cardinality', () => {
    const values = [{ id: ' recA ', title: 'A,B' }, { id: 42, title: 123 }, { id: 'recC' }];
    expect(normalizeRecordLinkPasteValue(values, true)._unsafeUnwrap()).toEqual([
      { id: 'recA', title: 'A,B' },
      { id: '42' },
      { id: 'recC' },
    ]);
    expect(normalizeRecordLinkPasteValue(values, false)._unsafeUnwrap()).toEqual({
      id: 'recA',
      title: 'A,B',
    });
    expect(normalizeRecordLinkPasteValue({ id: 'recA', title: '' }, false)._unsafeUnwrap()).toEqual(
      {
        id: 'recA',
        title: '',
      }
    );
  });

  it('comma-joins mixed tokens and ids without forcing titles or flattening nested items', () => {
    const values = [
      ' Alpha ',
      { id: ' recB ', title: 'Not this title' },
      [{ id: 'recNested' }],
      {},
      null,
      42,
      ' ',
    ];
    expect(normalizeRecordLinkPasteValue(values, true)._unsafeUnwrap()).toBe('Alpha,recB');
    expect(normalizeRecordLinkPasteValue(values, false)._unsafeUnwrap()).toBe('Alpha,recB');
    expect(normalizeRecordLinkPasteValue([[{ id: 'recNested' }]], true)._unsafeUnwrap()).toBeNull();
    expect(normalizeRecordLinkPasteValue([' Alpha ', ' Beta '], false)._unsafeUnwrap()).toBe(
      'Alpha,Beta'
    );
  });

  it.each([null, undefined, '', '  ', [], [null, {}, { id: '' }, { id: ' ' }, { title: 'No id' }]])(
    'returns null for empty or discarded input %j',
    (value) => expect(normalizeRecordLinkPasteValue(value, true)._unsafeUnwrap()).toBeNull()
  );

  it('reports malformed id serialization as a Result error rather than discarding it', () => {
    expect(
      normalizeRecordLinkPasteValue({ id: Object.create(null) }, true)._unsafeUnwrapErr().code
    ).toBe('paste.invalid_link_cell_value');
    const cause = new TypeError('Cannot serialize copied link id');
    const result = normalizeRecordLinkPasteValue(
      {
        id: {
          toString() {
            throw cause;
          },
        },
      },
      true
    );
    expect(result._unsafeUnwrapErr().cause).toBe(cause);
  });
});
