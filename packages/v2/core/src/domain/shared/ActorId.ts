import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from './ValueObject';

const actorIdSchema = z.string().min(1);

export class ActorId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ActorId, string> {
    const parsed = actorIdSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid ActorId');
    return ok(new ActorId(parsed.data));
  }

  equals(other: ActorId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
