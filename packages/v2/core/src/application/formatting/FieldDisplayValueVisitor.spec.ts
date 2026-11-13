import { describe, expect, it } from 'vitest';

import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { AttachmentField } from '../../domain/table/fields/types/AttachmentField';
import { CellValueMultiplicity } from '../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../domain/table/fields/types/CellValueType';
import { CreatedTimeField } from '../../domain/table/fields/types/CreatedTimeField';
import { DateField } from '../../domain/table/fields/types/DateField';
import { DateTimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import { FormulaExpression } from '../../domain/table/fields/types/FormulaExpression';
import { FormulaField } from '../../domain/table/fields/types/FormulaField';
import { LastModifiedTimeField } from '../../domain/table/fields/types/LastModifiedTimeField';
import { LookupField } from '../../domain/table/fields/types/LookupField';
import { LookupOptions } from '../../domain/table/fields/types/LookupOptions';
import { MultipleSelectField } from '../../domain/table/fields/types/MultipleSelectField';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { NumberFormatting } from '../../domain/table/fields/types/NumberFormatting';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { UserField } from '../../domain/table/fields/types/UserField';
import { UserMultiplicity } from '../../domain/table/fields/types/UserMultiplicity';
import { FieldDisplayValueVisitor } from './FieldDisplayValueVisitor';

const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();
const fieldName = (value: string) => FieldName.create(value)._unsafeUnwrap();

describe('prepared native display values', () => {
  it('reuses prepared numeric formatting while preserving currency rounding and signs', () => {
    const format = NumberField.create({
      id: fieldId('l'),
      name: fieldName('Amount'),
      formatting: NumberFormatting.create({
        type: 'currency',
        precision: 2,
        symbol: '$',
      })._unsafeUnwrap(),
    })
      .andThen((field) => field.accept(new FieldDisplayValueVisitor()))
      ._unsafeUnwrap();
    expect(
      [-1234.565, -0, 1.005, Number.NaN, Number.POSITIVE_INFINITY].map((value) =>
        format(value)._unsafeUnwrap()
      )
    ).toEqual(['-$1,234.57', '$0.00', '$1.01', '$NaN', '$∞']);
    expect(format(null)._unsafeUnwrap()).toBe('');
  });

  it('preserves historical text and select scalars instead of clipboard coercion', () => {
    const text = SingleLineTextField.create({ id: fieldId('a'), name: fieldName('Text') })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const select = SingleSelectField.create({
      id: fieldId('b'),
      name: fieldName('Status'),
      options: [],
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const malformed = { title: 'Historical object' };
    const scalarArray = ['Alpha', 'Beta'];
    expect(text(42)._unsafeUnwrap()).toBe(42);
    expect(text(malformed)._unsafeUnwrap()).toBe(malformed);
    expect(text(scalarArray)._unsafeUnwrap()).toBe(scalarArray);
    expect(select(false)._unsafeUnwrap()).toBe(false);
    expect(select(['Alpha, Beta', 'Gamma'])._unsafeUnwrap()).toBe('Alpha, Beta, Gamma');
    expect(text(null)._unsafeUnwrap()).toBe('');
    expect(select(undefined)._unsafeUnwrap()).toBe('');
  });

  it('quotes multiple select and user commas but preserves null array slots', () => {
    const select = MultipleSelectField.create({
      id: fieldId('c'),
      name: fieldName('Tags'),
      options: [],
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const user = UserField.create({
      id: fieldId('d'),
      name: fieldName('Owners'),
      isMultiple: UserMultiplicity.multiple(),
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    expect(select(['Alpha, Beta', null, 'Gamma'])._unsafeUnwrap()).toBe('"Alpha, Beta", , Gamma');
    expect(user([{ title: 'Doe, Jane' }, null, { title: 'Alex' }])._unsafeUnwrap()).toBe(
      '"Doe, Jane", , Alex'
    );
    expect(user([{ title: 42 }]).isErr()).toBe(true);
  });

  it.each([
    { kind: 'created-time', fieldClass: CreatedTimeField },
    { kind: 'last-modified-time', fieldClass: LastModifiedTimeField },
  ])('retains outer lookup multiplicity for $kind fields', ({ fieldClass }) => {
    const createdTime = fieldClass
      .create({
        id: fieldId('e'),
        name: fieldName('Created'),
        formatting: DateTimeFormatting.create({
          date: 'YYYY-MM-DD',
          time: 'HH:mm',
          timeZone: 'Asia/Tokyo',
        })._unsafeUnwrap(),
      })
      ._unsafeUnwrap();
    const lookup = LookupField.create({
      id: fieldId('f'),
      name: fieldName('Created values'),
      innerField: createdTime,
      isMultipleCellValue: true,
      lookupOptions: LookupOptions.create({
        linkFieldId: fieldId('g').toString(),
        foreignTableId: `tbl${'h'.repeat(16)}`,
        lookupFieldId: createdTime.id().toString(),
      })._unsafeUnwrap(),
    })._unsafeUnwrap();
    const format = lookup.accept(new FieldDisplayValueVisitor())._unsafeUnwrap();
    expect(
      format(['2026-02-01T23:45:00.000Z', null, '2026-02-02T23:45:00.000Z'])._unsafeUnwrap()
    ).toBe('2026-02-02 08:45, , 2026-02-03 08:45');
    expect(format(null)._unsafeUnwrap()).toBe('');
    expect(format('2026-02-01T23:45:00.000Z').isErr()).toBe(true);
  });

  it('returns errors rather than equal empty strings for malformed date and computed values', () => {
    const date = DateField.create({ id: fieldId('i'), name: fieldName('Date') })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    const computed = FormulaField.create({
      id: fieldId('j'),
      name: fieldName('Computed'),
      expression: FormulaExpression.create('NOW()')._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.dateTime(),
        isMultipleCellValue: CellValueMultiplicity.multiple(),
      },
    })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    expect(date('not-a-date')._unsafeUnwrapErr().code).toBe('formatting.invalid_cell_value');
    expect(computed('2026-02-01T23:45:00.000Z').isErr()).toBe(true);
    expect(computed(['not-a-date']).isErr()).toBe(true);
    expect(computed([null])._unsafeUnwrap()).toBe('');
  });

  it('preserves attachment item text while reporting malformed container values', () => {
    const format = AttachmentField.create({ id: fieldId('k'), name: fieldName('Files') })
      ._unsafeUnwrap()
      .accept(new FieldDisplayValueVisitor())
      ._unsafeUnwrap();
    expect(format([{ name: 'a.txt', token: 'token-a' }, null, {}])._unsafeUnwrap()).toBe(
      'a.txt (token-a),,undefined (undefined)'
    );
    expect(format({ name: 'Historical scalar' }).isErr()).toBe(true);
    expect(format(null)._unsafeUnwrap()).toBe('');
  });
});
