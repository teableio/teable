import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../ValueObject';

const pageLimitSchema = z.number().int().positive();

export class PageLimit extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<PageLimit, string> {
    const parsed = pageLimitSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid PageLimit');
    return ok(new PageLimit(parsed.data));
  }

  equals(other: PageLimit): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
