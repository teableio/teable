import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId, prefixedIdRegex } from '../../shared/IdGenerator';
import { ValueObject } from '../../shared/ValueObject';

const viewIdPrefix = 'viw';
const viewIdBodyLength = 16;
const viewIdSchema = z.string().regex(prefixedIdRegex(viewIdPrefix, viewIdBodyLength));

export class ViewId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<ViewId, DomainError> {
    const parsed = viewIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ViewId' }));
    return ok(new ViewId(parsed.data));
  }

  static generate(): Result<ViewId, DomainError> {
    try {
      return ok(new ViewId(generatePrefixedId(viewIdPrefix, viewIdBodyLength)));
    } catch {
      return err(domainError.unexpected({ message: 'Failed to generate ViewId' }));
    }
  }

  equals(other: ViewId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
