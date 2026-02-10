import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const dateDefaultValueSchema = z.enum(['now']);
type DateDefaultValueLiteral = z.infer<typeof dateDefaultValueSchema>;

export class DateDefaultValue extends ValueObject {
  private constructor(private readonly value: DateDefaultValueLiteral) {
    super();
  }

  static create(raw: unknown): Result<DateDefaultValue, DomainError> {
    const parsed = dateDefaultValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid DateDefaultValue' }));
    return ok(new DateDefaultValue(parsed.data));
  }

  equals(other: DateDefaultValue): boolean {
    return this.value === other.value;
  }

  toString(): DateDefaultValueLiteral {
    return this.value;
  }
}
