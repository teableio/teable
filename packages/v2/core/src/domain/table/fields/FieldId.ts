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

  static mustGenerate(): FieldId {
    const result = FieldId.generate();
    if (result.isOk()) return result.value;
    const fallbackBody = Math.random()
      .toString(36)
      .slice(2)
      .padEnd(fieldIdBodyLength, '0')
      .slice(0, fieldIdBodyLength);
    return new FieldId(`${fieldIdPrefix}${fallbackBody}`);
  }

  equals(other: FieldId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
