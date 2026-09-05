import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

export class ViewName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ViewName, DomainError> {
    if (typeof raw !== 'string') {
      return err(domainError.validation({ message: 'Invalid ViewName' }));
    }
    return ok(new ViewName(raw));
  }

  equals(other: ViewName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
