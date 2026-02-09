import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from './DomainError';
import { ValueObject } from './ValueObject';

export abstract class RehydratedValueObject extends ValueObject {
  private readonly rawValue: string | undefined;

  protected constructor(rawValue?: string) {
    super();
    this.rawValue = rawValue;
  }

  protected valueResult(typeName: string): Result<string, DomainError> {
    if (typeof this.rawValue !== 'string' || this.rawValue.length === 0) {
      return err(
        domainError.invariant({ message: `${typeName} is not available before rehydrate` })
      );
    }
    return ok(this.rawValue);
  }

  isRehydrated(): boolean {
    return typeof this.rawValue === 'string' && this.rawValue.length > 0;
  }

  equals(other: this): boolean {
    return this.rawValue === other.rawValue;
  }
}
