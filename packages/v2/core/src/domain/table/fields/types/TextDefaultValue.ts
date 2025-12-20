import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const textDefaultValueSchema = z
  .string()
  .transform((value) => (typeof value === 'string' ? value.trim() : value));

export class TextDefaultValue extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<TextDefaultValue, string> {
    const parsed = textDefaultValueSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid TextDefaultValue');
    return ok(new TextDefaultValue(parsed.data));
  }

  equals(other: TextDefaultValue): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
