import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';

const baseNameSchema = z.string().trim().min(1);

export class BaseName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<BaseName, DomainError> {
    const parsed = baseNameSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid BaseName' }));
    return ok(new BaseName(parsed.data));
  }

  equals(other: BaseName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
