import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { AttachmentField } from '../types/AttachmentField';
import { AutoNumberField } from '../types/AutoNumberField';
import { CellValueMultiplicity } from '../types/CellValueMultiplicity';
import { CellValueType } from '../types/CellValueType';
import { CheckboxField } from '../types/CheckboxField';
import { DateField } from '../types/DateField';
import { FormulaExpression } from '../types/FormulaExpression';
import { FormulaField } from '../types/FormulaField';
import { LinkField } from '../types/LinkField';
import { LinkFieldConfig } from '../types/LinkFieldConfig';
import { LongTextField } from '../types/LongTextField';
import { LookupField } from '../types/LookupField';
import { LookupOptions } from '../types/LookupOptions';
import { MultipleSelectField } from '../types/MultipleSelectField';
import { NumberField } from '../types/NumberField';
import { RatingField } from '../types/RatingField';
import { SelectOption } from '../types/SelectOption';
import { SingleLineTextField } from '../types/SingleLineTextField';
import { SingleSelectField } from '../types/SingleSelectField';
import { UserField } from '../types/UserField';
import { UserMultiplicity } from '../types/UserMultiplicity';
import { SearchDocumentFieldContributionVisitor } from './SearchVectorFieldContributionVisitor';

const fieldId = (value: string) => FieldId.create(value)._unsafeUnwrap();
const fieldName = (value: string) => FieldName.create(value)._unsafeUnwrap();

const sampleLookupOptions = LookupOptions.create({
  linkFieldId: 'fld0000000000000090',
  lookupFieldId: 'fld0000000000000091',
  foreignTableId: 'tbl0000000000000001',
})._unsafeUnwrap();

describe('SearchDocumentFieldContributionVisitor', () => {
  const visitor = new SearchDocumentFieldContributionVisitor();

  it.each([
    {
      name: 'generated auto number dependency',
      field: AutoNumberField.create({
        id: fieldId('fld0000000000000019'),
        name: fieldName('Auto number'),
      })._unsafeUnwrap(),
      expected: { included: false, skippedReason: 'generated_column_dependency' },
    },
    {
      name: 'multiple numeric lookup with canonical rounded projection',
      field: LookupField.create({
        id: fieldId('fld0000000000000020'),
        name: fieldName('Amounts'),
        innerField: NumberField.create({
          id: fieldId('fld0000000000000021'),
          name: fieldName('Amount'),
        })._unsafeUnwrap(),
        lookupOptions: sampleLookupOptions,
        isMultipleCellValue: true,
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'rounded_number_list', precision: 2 } },
    },
    {
      name: 'single line text',
      field: SingleLineTextField.create({
        id: fieldId('fld0000000000000001'),
        name: fieldName('Title'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'plain' } },
    },
    {
      name: 'long text',
      field: LongTextField.create({
        id: fieldId('fld0000000000000002'),
        name: fieldName('Notes'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'multiline' } },
    },
    {
      name: 'string formula',
      field: FormulaField.create({
        id: fieldId('fld0000000000000010'),
        name: fieldName('Title formula'),
        expression: FormulaExpression.create('""')._unsafeUnwrap(),
        resultType: {
          cellValueType: CellValueType.string(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'plain' } },
    },
    {
      name: 'text lookup',
      field: LookupField.create({
        id: fieldId('fld0000000000000011'),
        name: fieldName('Lookup title'),
        innerField: SingleLineTextField.create({
          id: fieldId('fld0000000000000012'),
          name: fieldName('Inner title'),
        })._unsafeUnwrap(),
        lookupOptions: sampleLookupOptions,
        isMultipleCellValue: false,
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'plain' } },
    },
    {
      name: 'number',
      field: NumberField.create({
        id: fieldId('fld0000000000000003'),
        name: fieldName('Amount'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'rounded_number', precision: 2 } },
    },
    {
      name: 'rating',
      field: RatingField.create({
        id: fieldId('fld0000000000000013'),
        name: fieldName('Score'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'rounded_number', precision: 0 } },
    },
    {
      name: 'number formula',
      field: FormulaField.create({
        id: fieldId('fld0000000000000014'),
        name: fieldName('Amount formula'),
        expression: FormulaExpression.create('1')._unsafeUnwrap(),
        resultType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'rounded_number', precision: 0 } },
    },
    {
      name: 'single select',
      field: SingleSelectField.create({
        id: fieldId('fld0000000000000015'),
        name: fieldName('Status'),
        options: [SelectOption.create({ name: 'Open', color: 'blue' })._unsafeUnwrap()],
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'plain' } },
    },
    {
      name: 'checkbox',
      field: CheckboxField.create({
        id: fieldId('fld0000000000000004'),
        name: fieldName('Done'),
      })._unsafeUnwrap(),
      expected: { included: false, skippedReason: 'non_text_value' },
    },
    {
      name: 'date',
      field: DateField.create({
        id: fieldId('fld0000000000000005'),
        name: fieldName('Due'),
      })._unsafeUnwrap(),
      expected: { included: false, skippedReason: 'non_text_value' },
    },
    {
      name: 'single user',
      field: UserField.create({
        id: fieldId('fld0000000000000006'),
        name: fieldName('Owner'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'structured_title' } },
    },
    {
      name: 'multiple user',
      field: UserField.create({
        id: fieldId('fld0000000000000007'),
        name: fieldName('Collaborators'),
        isMultiple: UserMultiplicity.multiple(),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'structured_title_list' } },
    },
    {
      name: 'multiple select',
      field: MultipleSelectField.create({
        id: fieldId('fld0000000000000008'),
        name: fieldName('Tags'),
        options: [SelectOption.create({ name: 'Alpha', color: 'blue' })._unsafeUnwrap()],
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'plain_list' } },
    },
    {
      name: 'attachment',
      field: AttachmentField.create({
        id: fieldId('fld0000000000000009'),
        name: fieldName('Files'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'structured_title_list' } },
    },
    {
      name: 'attachment lookup',
      field: LookupField.create({
        id: fieldId('fld0000000000000016'),
        name: fieldName('Lookup files'),
        innerField: AttachmentField.create({
          id: fieldId('fld0000000000000017'),
          name: fieldName('Inner files'),
        })._unsafeUnwrap(),
        lookupOptions: sampleLookupOptions,
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'structured_title_list' } },
    },
    {
      name: 'link',
      field: LinkField.create({
        id: fieldId('fld0000000000000018'),
        name: fieldName('Related'),
        config: LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: 'tbl0000000000000001',
          lookupFieldId: 'fld0000000000000091',
          isOneWay: true,
        })._unsafeUnwrap(),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: { kind: 'structured_title_list' } },
    },
  ])('$name has an explicit contribution decision', ({ field, expected }) => {
    const result = field.accept(visitor)._unsafeUnwrap();

    expect(result).toMatchObject(expected);
    expect(result.fieldId).toBe(field.id().toString());
    expect(result.fieldType).toBe(field.type().toString());
  });
});
