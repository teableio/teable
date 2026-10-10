import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import { generatePrefixedId } from '../shared/IdGenerator';
import { ValueObject } from '../shared/ValueObject';

const baseIdPrefix = 'bse';
const baseIdBodyLength = 16;

export class BaseId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<BaseId, DomainError> {
    if (typeof raw !== 'string') {
      return err(domainError.validation({ message: 'Invalid BaseId' }));
    }
    return ok(new BaseId(raw));
  }

  static generate(): Result<BaseId, DomainError> {
    try {
      return ok(new BaseId(generatePrefixedId(baseIdPrefix, baseIdBodyLength)));
    } catch {
      return err(domainError.unexpected({ message: 'Failed to generate BaseId' }));
    }
  }

  equals(other: BaseId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
