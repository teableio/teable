import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const checkboxDefaultValueSchema = z.boolean();

export class CheckboxDefaultValue extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<CheckboxDefaultValue, DomainError> {
    const parsed = checkboxDefaultValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid CheckboxDefaultValue' }));
    return ok(new CheckboxDefaultValue(parsed.data));
  }

  equals(other: CheckboxDefaultValue): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
