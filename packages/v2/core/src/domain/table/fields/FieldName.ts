import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

export class FieldName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<FieldName, DomainError> {
    if (typeof raw !== 'string') {
      return err(domainError.validation({ message: 'Invalid FieldName' }));
    }
    const value = raw.trim();
    if (value.length === 0) {
      return err(domainError.validation({ message: 'Invalid FieldName' }));
    }
    return ok(new FieldName(value));
  }

  equals(other: FieldName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
