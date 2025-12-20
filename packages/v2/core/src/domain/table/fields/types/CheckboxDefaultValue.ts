import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const checkboxDefaultValueSchema = z.boolean();

export class CheckboxDefaultValue extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<CheckboxDefaultValue, string> {
    const parsed = checkboxDefaultValueSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid CheckboxDefaultValue');
    return ok(new CheckboxDefaultValue(parsed.data));
  }

  equals(other: CheckboxDefaultValue): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
