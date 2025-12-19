import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const numericPrecisionSchema = z.number().int().min(0).max(5);

export class NumericPrecision extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<NumericPrecision, string> {
    const parsed = numericPrecisionSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid NumericPrecision');
    return ok(new NumericPrecision(parsed.data));
  }

  static default(): NumericPrecision {
    return new NumericPrecision(2);
  }

  static integer(): NumericPrecision {
    return new NumericPrecision(0);
  }

  equals(other: NumericPrecision): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
