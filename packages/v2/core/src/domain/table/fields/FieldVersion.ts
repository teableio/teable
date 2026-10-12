import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const fieldVersionSchema = z.number().int().nonnegative();

/**
 * Persistence/realtime version rehydrated with a Field child.
 *
 * New Fields do not have a version until the Table aggregate is persisted.
 */
export class FieldVersion extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static rehydrate(raw: unknown): Result<FieldVersion, DomainError> {
    const parsed = fieldVersionSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid FieldVersion' }));
    }
    return ok(new FieldVersion(parsed.data));
  }

  toNumber(): number {
    return this.value;
  }

  equals(other: FieldVersion): boolean {
    return this.value === other.value;
  }
}
