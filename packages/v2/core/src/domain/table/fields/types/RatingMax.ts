import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const ratingMaxSchema = z.number().int().min(1).max(10);

export class RatingMax extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<RatingMax, DomainError> {
    const parsed = ratingMaxSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid RatingMax' }));
    return ok(new RatingMax(parsed.data));
  }

  static five(): RatingMax {
    return new RatingMax(5);
  }

  equals(other: RatingMax): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
