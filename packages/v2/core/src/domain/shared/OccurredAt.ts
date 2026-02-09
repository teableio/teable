import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from './DomainError';
import { ValueObject } from './ValueObject';

const occurredAtSchema = z.instanceof(Date);

export class OccurredAt extends ValueObject {
  private constructor(private readonly value: Date) {
    super();
  }

  static now(): OccurredAt {
    return new OccurredAt(new Date());
  }

  static create(raw: unknown): Result<OccurredAt, DomainError> {
    const parsed = occurredAtSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid OccurredAt' }));
    return ok(new OccurredAt(parsed.data));
  }

  equals(other: OccurredAt): boolean {
    return this.value.getTime() === other.value.getTime();
  }

  toDate(): Date {
    return new Date(this.value);
  }
}
