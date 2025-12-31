import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from './DomainError';
import { ValueObject } from './ValueObject';

const actorIdSchema = z.string().min(1);

export class ActorId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ActorId, DomainError> {
    const parsed = actorIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ActorId' }));
    return ok(new ActorId(parsed.data));
  }

  equals(other: ActorId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
