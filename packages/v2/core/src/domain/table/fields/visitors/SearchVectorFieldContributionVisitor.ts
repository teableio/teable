import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
import { CellValueType } from '../types/CellValueType';
import type { CheckboxField } from '../types/CheckboxField';
import type { ConditionalLookupField } from '../types/ConditionalLookupField';
import type { ConditionalRollupField } from '../types/ConditionalRollupField';
import type { CreatedByField } from '../types/CreatedByField';
import type { CreatedTimeField } from '../types/CreatedTimeField';
import type { DateField } from '../types/DateField';
import type { FormulaField } from '../types/FormulaField';
import type { LastModifiedByField } from '../types/LastModifiedByField';
import type { LastModifiedTimeField } from '../types/LastModifiedTimeField';
import type { LinkField } from '../types/LinkField';
import type { LongTextField } from '../types/LongTextField';
import type { LookupField } from '../types/LookupField';
import type { MultipleSelectField } from '../types/MultipleSelectField';
import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { RollupField } from '../types/RollupField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { UserField } from '../types/UserField';
import { FieldValueTypeVisitor } from './FieldValueTypeVisitor';
import type { IFieldVisitor } from './IFieldVisitor';

export type SearchVectorFieldContribution = {
  readonly fieldId: string;
  readonly fieldType: string;
  readonly valueType?: string;
  readonly included: boolean;
  readonly textProjection?: 'text_cast';
  readonly skippedReason?:
    | 'non_text_value'
    | 'unsupported_search_field_type'
    | 'generated_column_dependency';
};

const valueTypeVisitor = new FieldValueTypeVisitor();

const include = (field: Field): SearchVectorFieldContribution => ({
  fieldId: field.id().toString(),
  fieldType: field.type().toString(),
  valueType: CellValueType.string().toString(),
  included: true,
  textProjection: 'text_cast',
});

const skip = (
  field: Field,
  skippedReason: SearchVectorFieldContribution['skippedReason'],
  valueType?: string
): SearchVectorFieldContribution => ({
  fieldId: field.id().toString(),
  fieldType: field.type().toString(),
  ...(valueType ? { valueType } : {}),
  included: false,
  skippedReason,
});

export class SearchVectorFieldContributionVisitor
  implements IFieldVisitor<SearchVectorFieldContribution>
{
  private byValueType(field: Field): Result<SearchVectorFieldContribution, DomainError> {
    return field
      .accept(valueTypeVisitor)
      .map(({ cellValueType }) =>
        cellValueType.equals(CellValueType.string())
          ? include(field)
          : skip(field, 'non_text_value', cellValueType.toString())
      );
  }

  private unsupported(field: Field): Result<SearchVectorFieldContribution, DomainError> {
    return ok(skip(field, 'unsupported_search_field_type'));
  }

  private generatedDependency(field: Field): Result<SearchVectorFieldContribution, DomainError> {
    return ok(skip(field, 'generated_column_dependency'));
  }

  visitSingleLineTextField(field: SingleLineTextField) {
    return ok(include(field));
  }

  visitLongTextField(field: LongTextField) {
    return ok(include(field));
  }

  visitNumberField(field: NumberField) {
    return this.byValueType(field);
  }

  visitRatingField(field: RatingField) {
    return this.byValueType(field);
  }

  visitFormulaField(field: FormulaField) {
    return this.byValueType(field);
  }

  visitRollupField(field: RollupField) {
    return this.byValueType(field);
  }

  visitSingleSelectField(field: SingleSelectField) {
    return ok(include(field));
  }

  visitMultipleSelectField(field: MultipleSelectField) {
    return ok(include(field));
  }

  visitCheckboxField(field: CheckboxField) {
    return this.unsupported(field);
  }

  visitAttachmentField(field: AttachmentField) {
    return this.unsupported(field);
  }

  visitDateField(field: DateField) {
    return this.byValueType(field);
  }

  visitCreatedTimeField(field: CreatedTimeField) {
    return this.generatedDependency(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField) {
    return this.generatedDependency(field);
  }

  visitUserField(field: UserField) {
    return ok(include(field));
  }

  visitCreatedByField(field: CreatedByField) {
    return this.generatedDependency(field);
  }

  visitLastModifiedByField(field: LastModifiedByField) {
    return this.generatedDependency(field);
  }

  visitAutoNumberField(field: AutoNumberField) {
    return this.generatedDependency(field);
  }

  visitButtonField(field: ButtonField) {
    return this.unsupported(field);
  }

  visitLinkField(field: LinkField) {
    return ok(include(field));
  }

  visitLookupField(field: LookupField) {
    return this.byValueType(field);
  }

  visitConditionalRollupField(field: ConditionalRollupField) {
    return this.byValueType(field);
  }

  visitConditionalLookupField(field: ConditionalLookupField) {
    return this.byValueType(field);
  }
}
