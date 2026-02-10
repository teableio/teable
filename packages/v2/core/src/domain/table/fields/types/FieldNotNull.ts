import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const fieldNotNullSchema = z.boolean();

export class FieldNotNull extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<FieldNotNull, DomainError> {
    const parsed = fieldNotNullSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldNotNull' }));
    return ok(new FieldNotNull(parsed.data));
  }

  static required(): FieldNotNull {
    return new FieldNotNull(true);
  }

  static optional(): FieldNotNull {
    return new FieldNotNull(false);
  }

  equals(other: FieldNotNull): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
