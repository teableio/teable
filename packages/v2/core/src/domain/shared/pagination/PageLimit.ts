import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../DomainError';
import { ValueObject } from '../ValueObject';

const pageLimitSchema = z.number().int().positive();

export class PageLimit extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<PageLimit, DomainError> {
    const parsed = pageLimitSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid PageLimit' }));
    return ok(new PageLimit(parsed.data));
  }

  equals(other: PageLimit): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
