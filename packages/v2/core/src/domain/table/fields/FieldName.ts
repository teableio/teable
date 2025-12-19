import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../shared/ValueObject';

const fieldNameSchema = z.string().trim().min(1).max(255);

export class FieldName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<FieldName, string> {
    const parsed = fieldNameSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid FieldName');
    return ok(new FieldName(parsed.data));
  }

  equals(other: FieldName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
