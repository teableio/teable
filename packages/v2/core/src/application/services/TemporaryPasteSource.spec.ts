import { describe, expect, it } from 'vitest';

import type { TemporaryPasteSourceField } from '../../commands/TemporaryPasteCommand';
import type { Field } from '../../domain/table/fields/Field';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITableFieldPersistenceDTO } from '../../ports/mappers/TableMapper';
import {
  convertTemporaryPasteCellValue,
  prepareTemporaryPasteSource,
} from './TemporaryPasteSource';

const fieldId = (seed: string) => `fld${seed.repeat(16)}`;
const tableId = (seed: string) => `tbl${seed.repeat(16)}`;
const mapper = new DefaultTableMapper();
const target = (dto: ITableFieldPersistenceDTO) => mapper.fieldFromDTO(dto)._unsafeUnwrap();
const text = () => target({ id: fieldId('a'), name: 'Text', type: 'singleLineText' });
const convert = (field: Field, header: TemporaryPasteSourceField, value: unknown) =>
  convertTemporaryPasteCellValue(
    field,
    prepareTemporaryPasteSource(field, header)._unsafeUnwrap(),
    value
  )._unsafeUnwrap();

const linkHeader = (foreignTableId: string): TemporaryPasteSourceField => ({
  id: fieldId('b'),
  name: 'Link',
  type: 'link',
  options: { foreignTableId, lookupFieldId: fieldId('c'), relationship: 'manyMany' },
});

const dateHeader: TemporaryPasteSourceField = {
  id: fieldId('d'),
  name: 'Dates',
  type: 'date',
  isLookup: true,
  isMultipleCellValue: true,
  lookupOptions: {
    linkFieldId: fieldId('e'),
    foreignTableId: tableId('f'),
    lookupFieldId: fieldId('g'),
  },
  options: { formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Singapore' } },
};

describe('temporary paste source conversion', () => {
  it('uses native source formatting for typed numbers but does not serialize raw text twice', () => {
    const header: TemporaryPasteSourceField = {
      type: 'number',
      options: { formatting: { type: 'percent', precision: 1 } },
    };
    expect(convert(text(), header, 0.126)).toBe('12.6%');
    expect(convert(text(), header, '12.6%')).toBe('12.6%');
    expect(convert(text(), { type: 'user', options: {} }, 'Alice, Bob')).toBe('Alice, Bob');
  });

  it('retains lookup date multiplicity for display and takes the first date for a scalar target', () => {
    const values = ['2023-06-19T06:50:48.017Z', '2023-06-20T06:50:48.017Z'];
    expect(convert(text(), dateHeader, values)).toBe('2023/06/19 14:50, 2023/06/20 14:50');
    const date = target({ id: fieldId('h'), name: 'Date', type: 'date' });
    expect(convert(date, dateHeader, values)).toBe(values[0]);
    expect(convert(date, dateHeader, '2023/06/19 14:50, 2023/06/20 14:50')).toBe(
      '2023-06-19T06:50:00.000Z'
    );
  });

  it('preserves quoted select names and typed choice arrays', () => {
    const header: TemporaryPasteSourceField = {
      type: 'multipleSelect',
      options: { choices: [] },
    };
    const single = target({
      id: fieldId('i'),
      name: 'Single',
      type: 'singleSelect',
      options: { choices: [] },
    });
    const multiple = target({
      id: fieldId('j'),
      name: 'Multiple',
      type: 'multipleSelect',
      options: { choices: [] },
    });
    expect(convert(multiple, header, ['A,B', 'C'])).toEqual(['A,B', 'C']);
    expect(convert(single, header, ['A,B', 'C'])).toBe('A,B');
    expect(convert(multiple, header, '"A,B",C')).toBe('"A,B",C');
    expect(convert(text(), header, ['A,B', 'C'])).toBe('"A,B", C');
  });

  it('flattens lookup identities and applies user cardinality before native verification', () => {
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
    const single = target({
      id: fieldId('k'),
      name: 'Owner',
      type: 'user',
      options: { isMultiple: false },
    });
    const multiple = target({
      id: fieldId('l'),
      name: 'Owners',
      type: 'user',
      options: { isMultiple: true },
    });
    expect(convert(single, header, [users])).toEqual(users[0]);
    expect(convert(multiple, header, [users])).toEqual(users);
    const attachments = [
      { token: 'tokenA', name: 'a.png' },
      { token: 'tokenB', name: 'b.png' },
    ];
    const attachment = target({ id: fieldId('m'), name: 'Files', type: 'attachment' });
    expect(
      convert(attachment, { type: 'attachment', isLookup: true, isMultipleCellValue: true }, [
        attachments,
      ])
    ).toEqual(attachments);
  });

  it('preserves link identities only for the same foreign table, otherwise resolves titles', () => {
    const link = target({
      id: fieldId('n'),
      name: 'Link',
      type: 'link',
      options: {
        foreignTableId: tableId('o'),
        lookupFieldId: fieldId('p'),
        relationship: 'manyMany',
      },
    });
    const items = [{ id: `rec${'q'.repeat(16)}`, title: 'A,B' }];
    const same = prepareTemporaryPasteSource(link, linkHeader(tableId('o')))._unsafeUnwrap();
    const different = prepareTemporaryPasteSource(link, linkHeader(tableId('r')))._unsafeUnwrap();
    expect(same.forceLinkTitles).toBe(false);
    expect(different.forceLinkTitles).toBe(true);
    expect(convertTemporaryPasteCellValue(link, same, items)._unsafeUnwrap()).toEqual(items);
    expect(convertTemporaryPasteCellValue(link, different, items)._unsafeUnwrap()).toEqual(['A,B']);
    expect(convertTemporaryPasteCellValue(link, same, 'Alpha, Beta')._unsafeUnwrap()).toBe(
      'Alpha, Beta'
    );
  });

  it('hydrates v1 lookup-link headers as value snapshots without their original relation', () => {
    const link = target({
      id: fieldId('s'),
      name: 'Link',
      type: 'link',
      options: {
        foreignTableId: tableId('o'),
        lookupFieldId: fieldId('p'),
        relationship: 'manyMany',
      },
    });
    const header: TemporaryPasteSourceField = {
      ...linkHeader(tableId('o')),
      isLookup: true,
      isComputed: true,
      isMultipleCellValue: true,
      // This is the lookup's outer relation, not the linked values' foreign table.
      lookupOptions: {
        linkFieldId: fieldId('t'),
        foreignTableId: tableId('u'),
        lookupFieldId: fieldId('v'),
      },
    };
    const values = [
      { id: `rec${'w'.repeat(16)}`, title: 'Alpha' },
      { id: `rec${'x'.repeat(16)}`, title: 'Beta' },
    ];
    const source = prepareTemporaryPasteSource(link, header)._unsafeUnwrap();
    expect(source.multiple).toBe(true);
    expect(source.forceLinkTitles).toBe(false);
    expect(convertTemporaryPasteCellValue(link, source, values)._unsafeUnwrap()).toEqual(values);
    expect(convert(text(), header, values)).toBe('Alpha, Beta');
  });

  it('retains outer lookup multiplicity and quoting on a scalar select inner type', () => {
    const header: TemporaryPasteSourceField = {
      type: 'singleSelect',
      options: { choices: [] },
      isLookup: true,
      isConditionalLookup: true,
      isComputed: true,
      isMultipleCellValue: true,
      lookupOptions: { foreignTableId: tableId('y'), lookupFieldId: fieldId('z') },
    };
    const multiple = target({
      id: fieldId('i'),
      name: 'Choices',
      type: 'multipleSelect',
      options: { choices: [] },
    });
    expect(convert(multiple, header, ['A,B', 'C'])).toEqual(['A,B', 'C']);
    expect(convert(text(), header, ['A,B', 'C'])).toBe('"A,B", C');
  });

  it.each(['formula', 'rollup'] as const)(
    'preserves %s result metadata and multiplicity',
    (type) => {
      const header: TemporaryPasteSourceField = {
        type,
        options: { expression: 'SUM({values})', formatting: { type: 'decimal', precision: 1 } },
        cellValueType: 'number',
        isComputed: true,
        isLookup: true,
        isMultipleCellValue: true,
        lookupOptions: {
          linkFieldId: fieldId('e'),
          foreignTableId: tableId('f'),
          lookupFieldId: fieldId('g'),
          relationship: 'manyMany',
        },
      };
      expect(convert(text(), header, [1, 2])).toBe('1.0, 2.0');
    }
  );

  it.each(['createdTime', 'lastModifiedTime'] as const)(
    'formats computed timestamp arrays for %s source headers',
    (type) => {
      const header: TemporaryPasteSourceField = {
        type,
        options: {
          expression: type === 'createdTime' ? 'CREATED_TIME()' : 'LAST_MODIFIED_TIME()',
          formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
        },
        isComputed: true,
        isLookup: true,
        isMultipleCellValue: true,
      };
      expect(
        convert(text(), header, ['2023-06-19T06:50:48.017Z', '2023-06-20T06:50:48.017Z'])
      ).toBe('2023/06/19 14:50, 2023/06/20 14:50');
    }
  );

  it('formats scalar datetime formula results rather than treating them as display text', () => {
    expect(
      convert(
        text(),
        {
          type: 'formula',
          options: {
            expression: 'CREATED_TIME()',
            formatting: { date: 'YYYY/MM/DD', time: 'HH:mm', timeZone: 'Asia/Singapore' },
          },
          cellValueType: 'dateTime',
          isComputed: true,
          isMultipleCellValue: false,
        },
        '2023-06-19T06:50:48.017Z'
      )
    ).toBe('2023/06/19 14:50');
  });

  it('preserves already-formatted datetime clipboard display text', () => {
    expect(convert(text(), dateHeader, '2023/06/19 14:50')).toBe('2023/06/19 14:50');
  });

  it('returns a domain error for malformed source metadata', () => {
    expect(prepareTemporaryPasteSource(text(), { type: 'link', options: {} }).isErr()).toBe(true);
  });
});
