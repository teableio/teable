import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../DomainError';
import { ValueObject } from '../ValueObject';

const pageOffsetSchema = z.number().int().nonnegative();

export class PageOffset extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<PageOffset, DomainError> {
    const parsed = pageOffsetSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid PageOffset' }));
    return ok(new PageOffset(parsed.data));
  }

  static zero(): PageOffset {
    return new PageOffset(0);
  }

  equals(other: PageOffset): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
