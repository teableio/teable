import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import type { Field } from '../Field';
import type { AttachmentField } from '../types/AttachmentField';
import type { AutoNumberField } from '../types/AutoNumberField';
import type { ButtonField } from '../types/ButtonField';
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
import {
  isAllowedSubstringSearchIndexProjection,
  isSearchFieldTextProjection,
  resolveSearchFieldTextShape,
  type SearchFieldTextProjection,
} from './SearchFieldTextShape';

export type SearchDocumentFieldContribution = {
  readonly fieldId: string;
  readonly fieldType: string;
  readonly valueType?: string;
  readonly included: boolean;
  readonly textProjection?: SearchFieldTextProjection;
  readonly skippedReason?:
    | 'non_text_value'
    | 'unsupported_search_field_type'
    | 'generated_column_dependency'
    | 'wide_table_all_field_document';
};

const valueTypeVisitor = new FieldValueTypeVisitor();

const skip = (
  field: Field,
  skippedReason: SearchDocumentFieldContribution['skippedReason'],
  valueType?: string
): SearchDocumentFieldContribution => ({
  fieldId: field.id().toString(),
  fieldType: field.type().toString(),
  ...(valueType ? { valueType } : {}),
  included: false,
  skippedReason,
});

export class SearchDocumentFieldContributionVisitor
  implements IFieldVisitor<SearchDocumentFieldContribution>
{
  /**
   * Include only the substring-index allow list (plain/multiline text and
   * string formula/lookup). SearchFieldTextShape still describes ILIKE
   * projections for rejected types; those stay sequential, not in the document.
   */
  private byShape(field: Field): Result<SearchDocumentFieldContribution, DomainError> {
    return resolveSearchFieldTextShape(field).andThen((shape) =>
      field.accept(valueTypeVisitor).map(({ cellValueType }) => {
        if (isAllowedSubstringSearchIndexProjection(field, shape)) {
          return {
            fieldId: field.id().toString(),
            fieldType: field.type().toString(),
            valueType: cellValueType.toString(),
            included: true,
            textProjection: shape,
          } satisfies SearchDocumentFieldContribution;
        }
        if (isSearchFieldTextProjection(shape)) {
          return skip(field, 'unsupported_search_field_type', cellValueType.toString());
        }
        return skip(field, 'non_text_value', cellValueType.toString());
      })
    );
  }

  private unsupported(field: Field): Result<SearchDocumentFieldContribution, DomainError> {
    return ok(skip(field, 'unsupported_search_field_type'));
  }

  private generatedDependency(field: Field): Result<SearchDocumentFieldContribution, DomainError> {
    return ok(skip(field, 'generated_column_dependency'));
  }

  visitSingleLineTextField(field: SingleLineTextField) {
    return this.byShape(field);
  }

  visitLongTextField(field: LongTextField) {
    return this.byShape(field);
  }

  visitNumberField(field: NumberField) {
    return this.byShape(field);
  }

  visitRatingField(field: RatingField) {
    return this.byShape(field);
  }

  visitFormulaField(field: FormulaField) {
    return this.byShape(field);
  }

  visitRollupField(field: RollupField) {
    return this.byShape(field);
  }

  visitSingleSelectField(field: SingleSelectField) {
    return this.byShape(field);
  }

  visitMultipleSelectField(field: MultipleSelectField) {
    return this.byShape(field);
  }

  visitCheckboxField(field: CheckboxField) {
    return this.byShape(field);
  }

  visitAttachmentField(field: AttachmentField) {
    return this.byShape(field);
  }

  visitDateField(field: DateField) {
    return this.byShape(field);
  }

  visitCreatedTimeField(field: CreatedTimeField) {
    return this.generatedDependency(field);
  }

  visitLastModifiedTimeField(field: LastModifiedTimeField) {
    return this.generatedDependency(field);
  }

  visitUserField(field: UserField) {
    return this.byShape(field);
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
    return this.byShape(field);
  }

  visitLookupField(field: LookupField) {
    return this.byShape(field);
  }

  visitConditionalRollupField(field: ConditionalRollupField) {
    return this.byShape(field);
  }

  visitConditionalLookupField(field: ConditionalLookupField) {
    return this.byShape(field);
  }
}

/** @deprecated Use the semantics-neutral search-document names. */
export type SearchVectorFieldContribution = SearchDocumentFieldContribution;

/** @deprecated Use SearchDocumentFieldContributionVisitor. */
export class SearchVectorFieldContributionVisitor extends SearchDocumentFieldContributionVisitor {}
