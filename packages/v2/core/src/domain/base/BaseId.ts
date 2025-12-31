import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { generatePrefixedId, prefixedIdRegex } from '../shared/IdGenerator';
import { ValueObject } from '../shared/ValueObject';

const baseIdPrefix = 'bse';
const baseIdBodyLength = 16;
const baseIdSchema = z.string().regex(prefixedIdRegex(baseIdPrefix, baseIdBodyLength));

export class BaseId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<BaseId, DomainError> {
    const parsed = baseIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.fromMessage('Invalid BaseId'));
    return ok(new BaseId(parsed.data));
  }

  static generate(): Result<BaseId, DomainError> {
    try {
      return ok(new BaseId(generatePrefixedId(baseIdPrefix, baseIdBodyLength)));
    } catch {
      return err(domainError.fromMessage('Failed to generate BaseId'));
    }
  }

  equals(other: BaseId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
