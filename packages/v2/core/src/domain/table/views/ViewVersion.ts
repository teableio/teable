import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewVersionSchema = z.number().int().nonnegative();

/**
 * Persistence/realtime version rehydrated with a View child.
 *
 * New Views do not have a version until the Table aggregate is persisted.
 */
export class ViewVersion extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static rehydrate(raw: unknown): Result<ViewVersion, DomainError> {
    const parsed = viewVersionSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ViewVersion' }));
    }
    return ok(new ViewVersion(parsed.data));
  }

  toNumber(): number {
    return this.value;
  }

  equals(other: ViewVersion): boolean {
    return this.value === other.value;
  }
}
