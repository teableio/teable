import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const fieldUniqueSchema = z.boolean();

export class FieldUnique extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<FieldUnique, DomainError> {
    const parsed = fieldUniqueSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldUnique' }));
    return ok(new FieldUnique(parsed.data));
  }

  static enabled(): FieldUnique {
    return new FieldUnique(true);
  }

  static disabled(): FieldUnique {
    return new FieldUnique(false);
  }

  equals(other: FieldUnique): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
