import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../DomainError';
import { ValueObject } from '../ValueObject';

export const sortDirectionValues = ['asc', 'desc'] as const;
export const sortDirectionSchema = z.enum(sortDirectionValues);
export type SortDirectionValue = z.infer<typeof sortDirectionSchema>;

export class SortDirection extends ValueObject {
  private constructor(private readonly value: SortDirectionValue) {
    super();
  }

  static create(raw: unknown): Result<SortDirection, DomainError> {
    const parsed = sortDirectionSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid SortDirection' }));
    return ok(new SortDirection(parsed.data));
  }

  static from(value: SortDirectionValue): SortDirection {
    return new SortDirection(value);
  }

  static asc(): SortDirection {
    return new SortDirection('asc');
  }

  static desc(): SortDirection {
    return new SortDirection('desc');
  }

  equals(other: SortDirection): boolean {
    return this.value === other.value;
  }

  toString(): SortDirectionValue {
    return this.value;
  }
}
