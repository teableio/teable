import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const userMultiplicitySchema = z.boolean();

export class UserMultiplicity extends ValueObject {
  equals(other: UserMultiplicity): boolean {
    return this.value === other.value;
  }

  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<UserMultiplicity, DomainError> {
    const parsed = userMultiplicitySchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid UserMultiplicity' }));
    return ok(new UserMultiplicity(parsed.data));
  }

  static single(): UserMultiplicity {
    return new UserMultiplicity(false);
  }

  static multiple(): UserMultiplicity {
    return new UserMultiplicity(true);
  }

  toBoolean(): boolean {
    return this.value;
  }
}
