import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

export const ratingIconValues = [
  'star',
  'moon',
  'sun',
  'zap',
  'flame',
  'heart',
  'apple',
  'thumb-up',
] as const;

const ratingIconSchema = z.enum(ratingIconValues);
export type RatingIconValue = z.infer<typeof ratingIconSchema>;

export class RatingIcon extends ValueObject {
  private constructor(private readonly value: RatingIconValue) {
    super();
  }

  static create(raw: unknown): Result<RatingIcon, DomainError> {
    const parsed = ratingIconSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid RatingIcon' }));
    return ok(new RatingIcon(parsed.data));
  }

  static star(): RatingIcon {
    return new RatingIcon('star');
  }

  equals(other: RatingIcon): boolean {
    return this.value === other.value;
  }

  toString(): RatingIconValue {
    return this.value;
  }
}
