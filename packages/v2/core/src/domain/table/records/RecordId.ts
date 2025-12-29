import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { generatePrefixedId, prefixedIdRegex } from '../../shared/IdGenerator';
import { ValueObject } from '../../shared/ValueObject';

const recordIdPrefix = 'rec';
const recordIdBodyLength = 16;
const recordIdSchema = z.string().regex(prefixedIdRegex(recordIdPrefix, recordIdBodyLength));

export class RecordId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<RecordId, string> {
    const parsed = recordIdSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid RecordId');
    return ok(new RecordId(parsed.data));
  }

  static generate(): Result<RecordId, string> {
    try {
      return ok(new RecordId(generatePrefixedId(recordIdPrefix, recordIdBodyLength)));
    } catch {
      return err('Failed to generate RecordId');
    }
  }

  equals(other: RecordId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
