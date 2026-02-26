import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { MutateOnlySpec } from '../../shared/specification/MutateOnlySpec';
import type { FieldId } from '../fields/FieldId';
import { FieldHasError } from '../fields/types/FieldHasError';
import type { Table } from '../Table';
import type { ITableSpecVisitor } from './ITableSpecVisitor';

/**
 * Specification for updating a field's error state.
 * Used when computed fields have broken references or invalid configurations.
 *
 * Following v1 convention:
 * - hasError: true when field has configuration error
 * - hasError: null/false when no error (cleared state)
 */
export class TableUpdateFieldHasErrorSpec<
  V extends ITableSpecVisitor = ITableSpecVisitor,
> extends MutateOnlySpec<Table, V> {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly previousHasErrorValue: FieldHasError,
    private readonly nextHasErrorValue: FieldHasError
  ) {
    super();
  }

  static create(
    fieldId: FieldId,
    previousHasError: FieldHasError,
    nextHasError: FieldHasError
  ): TableUpdateFieldHasErrorSpec {
    return new TableUpdateFieldHasErrorSpec(fieldId, previousHasError, nextHasError);
  }

  /**
   * Create a spec to set error state
   */
  static setError(fieldId: FieldId, previousHasError: FieldHasError): TableUpdateFieldHasErrorSpec {
    return new TableUpdateFieldHasErrorSpec(fieldId, previousHasError, FieldHasError.error());
  }

  /**
   * Create a spec to clear error state
   */
  static clearError(
    fieldId: FieldId,
    previousHasError: FieldHasError
  ): TableUpdateFieldHasErrorSpec {
    return new TableUpdateFieldHasErrorSpec(fieldId, previousHasError, FieldHasError.ok());
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  previousHasError(): FieldHasError {
    return this.previousHasErrorValue;
  }

  nextHasError(): FieldHasError {
    return this.nextHasErrorValue;
  }

  /**
   * Whether this is setting an error (vs clearing one)
   */
  isSettingError(): boolean {
    return this.nextHasErrorValue.isError();
  }

  mutate(t: Table): Result<Table, DomainError> {
    return t.updateFieldHasError(this.fieldIdValue, this.nextHasErrorValue);
  }

  accept(v: V): Result<void, DomainError> {
    return v.visitTableUpdateFieldHasError(this).map(() => undefined);
  }
}
