import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const buttonMaxCountSchema = z.number();

export class ButtonMaxCount extends ValueObject {
  private constructor(private readonly value: number) {
    super();
  }

  static create(raw: unknown): Result<ButtonMaxCount, DomainError> {
    const parsed = buttonMaxCountSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ButtonMaxCount' }));
    return ok(new ButtonMaxCount(parsed.data));
  }

  equals(other: ButtonMaxCount): boolean {
    return this.value === other.value;
  }

  toNumber(): number {
    return this.value;
  }
}
