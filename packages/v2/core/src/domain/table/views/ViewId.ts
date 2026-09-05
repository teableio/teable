import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId, prefixedIdRegex } from '../../shared/IdGenerator';
import { ValueObject } from '../../shared/ValueObject';

const viewIdPrefix = 'viw';
const viewIdBodyLength = 16;
const viewIdPattern = prefixedIdRegex(viewIdPrefix, viewIdBodyLength);

export class ViewId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ViewId, DomainError> {
    if (typeof raw !== 'string' || !viewIdPattern.test(raw)) {
      return err(domainError.validation({ message: 'Invalid ViewId' }));
    }
    return ok(new ViewId(raw));
  }

  static generate(): Result<ViewId, DomainError> {
    try {
      return ok(new ViewId(generatePrefixedId(viewIdPrefix, viewIdBodyLength)));
    } catch {
      return err(domainError.unexpected({ message: 'Failed to generate ViewId' }));
    }
  }

  equals(other: ViewId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  /**
   * Get the row order column name for this view.
   * Row order columns store the position of records within a specific view.
   * Format: `__row_{viewId}`
   */
  toRowOrderColumnName(): string {
    return `__row_${this.value}`;
  }
}
