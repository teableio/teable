/* eslint-disable @typescript-eslint/naming-convention */
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

export const ratingColorValues = ['yellowBright', 'redBright', 'tealBright'] as const;

const ratingColorSchema = z.enum(ratingColorValues);
export type RatingColorValue = z.infer<typeof ratingColorSchema>;

export class RatingColor extends ValueObject {
  private constructor(private readonly value: RatingColorValue) {
    super();
  }

  static create(raw: unknown): Result<RatingColor, DomainError> {
    const parsed = ratingColorSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid RatingColor' }));
    return ok(new RatingColor(parsed.data));
  }

  static yellowBright(): RatingColor {
    return new RatingColor('yellowBright');
  }

  equals(other: RatingColor): boolean {
    return this.value === other.value;
  }

  toString(): RatingColorValue {
    return this.value;
  }
}
