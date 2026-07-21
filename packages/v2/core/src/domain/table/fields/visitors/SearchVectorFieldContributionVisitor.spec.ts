import { describe, expect, it } from 'vitest';

import { FieldId } from '../FieldId';
import { FieldName } from '../FieldName';
import { CheckboxField } from '../types/CheckboxField';
import { LongTextField } from '../types/LongTextField';
import { NumberField } from '../types/NumberField';
import { SingleLineTextField } from '../types/SingleLineTextField';
import { SearchVectorFieldContributionVisitor } from './SearchVectorFieldContributionVisitor';

const fieldId = (value: string) => FieldId.create(value)._unsafeUnwrap();
const fieldName = (value: string) => FieldName.create(value)._unsafeUnwrap();

describe('SearchVectorFieldContributionVisitor', () => {
  const visitor = new SearchVectorFieldContributionVisitor();

  it.each([
    {
      name: 'single line text',
      field: SingleLineTextField.create({
        id: fieldId('fld0000000000000001'),
        name: fieldName('Title'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: 'text_cast' },
    },
    {
      name: 'long text',
      field: LongTextField.create({
        id: fieldId('fld0000000000000002'),
        name: fieldName('Notes'),
      })._unsafeUnwrap(),
      expected: { included: true, textProjection: 'text_cast' },
    },
    {
      name: 'number',
      field: NumberField.create({
        id: fieldId('fld0000000000000003'),
        name: fieldName('Amount'),
      })._unsafeUnwrap(),
      expected: { included: false, skippedReason: 'non_text_value' },
    },
    {
      name: 'checkbox',
      field: CheckboxField.create({
        id: fieldId('fld0000000000000004'),
        name: fieldName('Done'),
      })._unsafeUnwrap(),
      expected: { included: false, skippedReason: 'unsupported_search_field_type' },
    },
  ])('$name has an explicit contribution decision', ({ field, expected }) => {
    const result = field.accept(visitor)._unsafeUnwrap();

    expect(result).toMatchObject(expected);
    expect(result.fieldId).toBe(field.id().toString());
    expect(result.fieldType).toBe(field.type().toString());
  });
});
