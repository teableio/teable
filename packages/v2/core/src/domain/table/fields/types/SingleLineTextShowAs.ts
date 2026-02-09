import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

export const singleLineTextShowAsValues = ['url', 'email', 'phone'] as const;

const singleLineTextShowAsSchema = z.object({
  type: z.enum(singleLineTextShowAsValues),
});

export type SingleLineTextShowAsValue = z.infer<typeof singleLineTextShowAsSchema>;

export class SingleLineTextShowAs extends ValueObject {
  private constructor(private readonly value: SingleLineTextShowAsValue) {
    super();
  }

  static create(raw: unknown): Result<SingleLineTextShowAs, DomainError> {
    const parsed = singleLineTextShowAsSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid SingleLineTextShowAs' }));
    return ok(new SingleLineTextShowAs(parsed.data));
  }

  equals(other: SingleLineTextShowAs): boolean {
    return this.value.type === other.value.type;
  }

  type(): SingleLineTextShowAsValue['type'] {
    return this.value.type;
  }

  toDto(): SingleLineTextShowAsValue {
    return { ...this.value };
  }
}
