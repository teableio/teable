import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewNameSchema = z.string().trim().min(1);

export class ViewName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ViewName, DomainError> {
    const parsed = viewNameSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ViewName' }));
    return ok(new ViewName(parsed.data));
  }

  equals(other: ViewName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
