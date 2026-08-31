import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewOrderSchema = z.number().finite();

/**
 * Stable ordering coordinate for a View child inside the Table aggregate.
 *
 * Newly-created Views may not have one until persistence allocates it. Hydrated
 * Views always carry it so aggregate behavior can calculate reorder specs.
 */
export class ViewOrder extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static rehydrate(raw: unknown): Result<ViewOrder, DomainError> {
    const parsed = viewOrderSchema.safeParse(raw);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ViewOrder' }));
    }
    return ok(new ViewOrder(parsed.data));
  }

  toNumber(): number {
    return this.value;
  }

  equals(other: ViewOrder): boolean {
    return this.value === other.value;
  }
}
