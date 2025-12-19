import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { generatePrefixedId, prefixedIdRegex } from '../../shared/IdGenerator';
import { ValueObject } from '../../shared/ValueObject';

const fieldIdPrefix = 'fld';
const fieldIdBodyLength = 16;
const fieldIdSchema = z.string().regex(prefixedIdRegex(fieldIdPrefix, fieldIdBodyLength));

export class FieldId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<FieldId, string> {
    const parsed = fieldIdSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid FieldId');
    return ok(new FieldId(parsed.data));
  }

  static generate(): Result<FieldId, string> {
    try {
      return ok(new FieldId(generatePrefixedId(fieldIdPrefix, fieldIdBodyLength)));
    } catch {
      return err('Failed to generate FieldId');
    }
  }

  equals(other: FieldId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
