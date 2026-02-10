import type { Result } from 'neverthrow';

import type { DomainError } from '../../../../shared/DomainError';
import type { ISpecification } from '../../../../shared/specification/ISpecification';
import type { ISpecVisitor } from '../../../../shared/specification/ISpecVisitor';
import type { TableRecord } from '../../TableRecord';

// Forward declarations for SetValueSpec types
import type { ClearFieldValueSpec } from './ClearFieldValueSpec';
import type { SetAttachmentValueSpec } from './SetAttachmentValueSpec';
import type { SetCheckboxValueSpec } from './SetCheckboxValueSpec';
import type { SetDateValueSpec } from './SetDateValueSpec';
import type { SetLinkValueByTitleSpec } from './SetLinkValueByTitleSpec';
import type { SetLinkValueSpec } from './SetLinkValueSpec';
import type { SetLongTextValueSpec } from './SetLongTextValueSpec';
import type { SetMultipleSelectValueSpec } from './SetMultipleSelectValueSpec';
import type { SetNumberValueSpec } from './SetNumberValueSpec';
import type { SetRatingValueSpec } from './SetRatingValueSpec';
import type { SetSingleLineTextValueSpec } from './SetSingleLineTextValueSpec';
import type { SetSingleSelectValueSpec } from './SetSingleSelectValueSpec';
import type { SetUserValueByIdentifierSpec } from './SetUserValueByIdentifierSpec';
import type { SetUserValueSpec } from './SetUserValueSpec';
import type { SetRowOrderValueSpec } from './SetRowOrderValueSpec';

/**
 * Base interface for cell value mutation specifications.
 * All SetValueSpec classes implement this interface.
 */
export type ICellValueSpec = ISpecification<TableRecord, ICellValueSpecVisitor>;

/**
 * Visitor interface for cell value mutation specs.
 *
 * This visitor is used to:
 * 1. Generate SQL column/value pairs in repository adapters (for UPDATE)
 * 2. Transform specs into persistence operations
 *
 * Each visit method corresponds to a specific field type's set operation.
 * Future operations (like IncrementNumberValueSpec) will add new visit methods.
 */
export interface ICellValueSpecVisitor extends ISpecVisitor {
  // Text types
  visitSetSingleLineTextValue(spec: SetSingleLineTextValueSpec): Result<void, DomainError>;
  visitSetLongTextValue(spec: SetLongTextValueSpec): Result<void, DomainError>;

  // Numeric types
  visitSetNumberValue(spec: SetNumberValueSpec): Result<void, DomainError>;
  visitSetRatingValue(spec: SetRatingValueSpec): Result<void, DomainError>;

  // Select types
  visitSetSingleSelectValue(spec: SetSingleSelectValueSpec): Result<void, DomainError>;
  visitSetMultipleSelectValue(spec: SetMultipleSelectValueSpec): Result<void, DomainError>;

  // Other types
  visitSetCheckboxValue(spec: SetCheckboxValueSpec): Result<void, DomainError>;
  visitSetDateValue(spec: SetDateValueSpec): Result<void, DomainError>;
  visitSetAttachmentValue(spec: SetAttachmentValueSpec): Result<void, DomainError>;
  visitSetLinkValue(spec: SetLinkValueSpec): Result<void, DomainError>;
  visitSetUserValue(spec: SetUserValueSpec): Result<void, DomainError>;
  visitSetUserValueByIdentifier(spec: SetUserValueByIdentifierSpec): Result<void, DomainError>;

  // Typecast operations (require SQL lookup)
  visitSetLinkValueByTitle(spec: SetLinkValueByTitleSpec): Result<void, DomainError>;

  // System column operations (record order)
  visitSetRowOrderValue(spec: SetRowOrderValueSpec): Result<void, DomainError>;

  // Clear operations (set field to null)
  visitClearFieldValue(spec: ClearFieldValueSpec): Result<void, DomainError>;

  // Future: increment operations
  // visitIncrementNumber(spec: IncrementNumberValueSpec): Result<void, DomainError>;
}
