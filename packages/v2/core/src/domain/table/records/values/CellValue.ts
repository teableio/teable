import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

/**
 * Generic CellValue Value Object that wraps validated cell values.
 *
 * CellValue<T> is used to hold typed values after validation via zod schemas.
 * The type T represents the underlying value type (string, number, boolean, etc.)
 */
export class CellValue<T> extends ValueObject {
  private constructor(private readonly value: T | null) {
    super();
  }

  /**
   * Create a CellValue from a validated value.
   * The value should already be validated by FieldCellValueSchemaVisitor
   * before being passed here.
   */
  static create<T>(value: T | null): Result<CellValue<T>, DomainError> {
    return ok(new CellValue(value));
  }

  /**
   * Create a CellValue directly from a validated value.
   * Use this when you're certain the value is already valid.
   */
  static fromValidated<T>(value: T | null): CellValue<T> {
    return new CellValue(value);
  }

  /**
   * Create a null CellValue
   */
  static null<T>(): CellValue<T> {
    return new CellValue<T>(null);
  }

  /**
   * Get the underlying value
   */
  toValue(): T | null {
    return this.value;
  }

  /**
   * Check if the value is null
   */
  isNull(): boolean {
    return this.value === null;
  }

  equals(other: CellValue<T>): boolean {
    if (this.value === null && other.value === null) {
      return true;
    }
    if (this.value === null || other.value === null) {
      return false;
    }
    // For primitive types, use strict equality
    // For objects/arrays, this may need to be extended
    return Object.is(this.value, other.value);
  }
}
