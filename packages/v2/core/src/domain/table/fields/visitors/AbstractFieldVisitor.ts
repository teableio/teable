import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
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
import type { IFieldVisitor } from './IFieldVisitor';

/**
 * Abstract base class for field visitors that provides default lookup handling.
 *
 * The key feature is that `visitLookupField` delegates to the inner field's visitor method,
 * so subclasses don't need to explicitly handle lookup fields unless they need special behavior.
 *
 * Example:
 * - A LookupField wrapping a NumberField will call visitNumberField by default
 * - Subclasses can override visitLookupField to add lookup-specific logic
 */
export abstract class AbstractFieldVisitor<T> implements IFieldVisitor<T> {
  /**
   * Default lookup handling: delegate to the inner field's visitor method.
   *
   * Override this method in subclasses when you need lookup-specific behavior,
   * such as:
   * - Returning a different dbFieldType for lookups
   * - Adding lookup metadata to the result
   * - Combining inner field result with lookup options
   */
  visitLookupField(field: LookupField): Result<T, DomainError> {
    return field.innerField().andThen((inner) => inner.accept(this));
  }

  abstract visitSingleLineTextField(field: SingleLineTextField): Result<T, DomainError>;
  abstract visitLongTextField(field: LongTextField): Result<T, DomainError>;
  abstract visitNumberField(field: NumberField): Result<T, DomainError>;
  abstract visitRatingField(field: RatingField): Result<T, DomainError>;
  abstract visitFormulaField(field: FormulaField): Result<T, DomainError>;
  abstract visitRollupField(field: RollupField): Result<T, DomainError>;
  abstract visitSingleSelectField(field: SingleSelectField): Result<T, DomainError>;
  abstract visitMultipleSelectField(field: MultipleSelectField): Result<T, DomainError>;
  abstract visitCheckboxField(field: CheckboxField): Result<T, DomainError>;
  abstract visitAttachmentField(field: AttachmentField): Result<T, DomainError>;
  abstract visitDateField(field: DateField): Result<T, DomainError>;
  abstract visitCreatedTimeField(field: CreatedTimeField): Result<T, DomainError>;
  abstract visitLastModifiedTimeField(field: LastModifiedTimeField): Result<T, DomainError>;
  abstract visitUserField(field: UserField): Result<T, DomainError>;
  abstract visitCreatedByField(field: CreatedByField): Result<T, DomainError>;
  abstract visitLastModifiedByField(field: LastModifiedByField): Result<T, DomainError>;
  abstract visitAutoNumberField(field: AutoNumberField): Result<T, DomainError>;
  abstract visitButtonField(field: ButtonField): Result<T, DomainError>;
  abstract visitLinkField(field: LinkField): Result<T, DomainError>;

  /**
   * Default conditional rollup handling: delegate to rollup's result type.
   * Similar to visitRollupField, but for conditional rollups.
   */
  abstract visitConditionalRollupField(field: ConditionalRollupField): Result<T, DomainError>;

  /**
   * Default conditional lookup handling: delegate to the inner field's visitor method.
   * Similar to visitLookupField.
   */
  visitConditionalLookupField(field: ConditionalLookupField): Result<T, DomainError> {
    return field.innerField().andThen((inner) => inner.accept(this));
  }
}
