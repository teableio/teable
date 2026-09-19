import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';

export class TableName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<TableName, DomainError> {
    if (typeof raw !== 'string') {
      return err(domainError.validation({ message: 'Invalid TableName' }));
    }
    const value = raw.trim();
    if (value.length === 0) {
      return err(domainError.validation({ message: 'Invalid TableName' }));
    }
    return ok(new TableName(value));
  }

  equals(other: TableName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
