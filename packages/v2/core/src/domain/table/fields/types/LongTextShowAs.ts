import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

export const longTextShowAsValues = ['markdown'] as const;

const longTextShowAsSchema = z.object({
  type: z.enum(longTextShowAsValues),
});

export type LongTextShowAsValue = z.infer<typeof longTextShowAsSchema>;

export class LongTextShowAs extends ValueObject {
  private constructor(private readonly value: LongTextShowAsValue) {
    super();
  }

  static create(raw: unknown): Result<LongTextShowAs, DomainError> {
    const parsed = longTextShowAsSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid LongTextShowAs' }));
    return ok(new LongTextShowAs(parsed.data));
  }

  equals(other: LongTextShowAs): boolean {
    return this.value.type === other.value.type;
  }

  type(): LongTextShowAsValue['type'] {
    return this.value.type;
  }

  toDto(): LongTextShowAsValue {
    return { ...this.value };
  }
}
