import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const fieldComputedSchema = z.boolean();

export class FieldComputed extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<FieldComputed, string> {
    const parsed = fieldComputedSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid FieldComputed');
    return ok(new FieldComputed(parsed.data));
  }

  static computed(): FieldComputed {
    return new FieldComputed(true);
  }

  static manual(): FieldComputed {
    return new FieldComputed(false);
  }

  equals(other: FieldComputed): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
