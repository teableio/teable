import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const numberDefaultValueSchema = z.number();

export class NumberDefaultValue extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<NumberDefaultValue, DomainError> {
    const parsed = numberDefaultValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid NumberDefaultValue' }));
    return ok(new NumberDefaultValue(parsed.data));
  }

  equals(other: NumberDefaultValue): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
