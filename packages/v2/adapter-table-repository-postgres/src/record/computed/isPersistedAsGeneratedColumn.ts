import {
  AbstractFieldVisitor,
  type AutoNumberField,
  type ConditionalLookupField,
  type CreatedByField,
  type CreatedTimeField,
  type DomainError,
  type Field,
  type FormulaField,
  type LastModifiedByField,
  type LastModifiedTimeField,
  type LookupField,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

class PersistedAsGeneratedColumnVisitor extends AbstractFieldVisitor<boolean> {
  visitSingleLineTextField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitLongTextField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitNumberField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitRatingField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitFormulaField(field: FormulaField): Result<boolean, DomainError> {
    // Only FormulaField has domain meta for this flag.
    return field.isPersistedAsGeneratedColumn();
  }
  visitRollupField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitSingleSelectField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitMultipleSelectField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitCheckboxField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitAttachmentField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitDateField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitCreatedTimeField(field: CreatedTimeField): Result<boolean, DomainError> {
    return field.isPersistedAsGeneratedColumn();
  }
  visitLastModifiedTimeField(field: LastModifiedTimeField): Result<boolean, DomainError> {
    return field.isPersistedAsGeneratedColumn();
  }
  visitUserField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitCreatedByField(field: CreatedByField): Result<boolean, DomainError> {
    return field.isPersistedAsGeneratedColumn();
  }
  visitLastModifiedByField(field: LastModifiedByField): Result<boolean, DomainError> {
    return field.isPersistedAsGeneratedColumn();
  }
  visitAutoNumberField(field: AutoNumberField): Result<boolean, DomainError> {
    return field.isPersistedAsGeneratedColumn();
  }
  visitButtonField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitLinkField(): Result<boolean, DomainError> {
    return ok(false);
  }
  visitConditionalRollupField(): Result<boolean, DomainError> {
    return ok(false);
  }

  // For persisted computed columns, lookup/conditional lookup are NOT generated columns.
  override visitLookupField(_field: LookupField): Result<boolean, DomainError> {
    return ok(false);
  }
  override visitConditionalLookupField(
    _field: ConditionalLookupField
  ): Result<boolean, DomainError> {
    return ok(false);
  }
}

const visitor = new PersistedAsGeneratedColumnVisitor();

export const isPersistedAsGeneratedColumn = (field: Field): Result<boolean, DomainError> => {
  return field.accept(visitor);
};
