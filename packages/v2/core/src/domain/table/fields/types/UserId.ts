import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const userIdSchema = z.string().startsWith('usr').or(z.literal('me'));

export class UserId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<UserId, DomainError> {
    const parsed = userIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid UserId' }));
    return ok(new UserId(parsed.data));
  }

  isMe(): boolean {
    return this.value === 'me';
  }

  equals(other: UserId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
