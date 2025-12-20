import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const buttonResetCountSchema = z.boolean();

export class ButtonResetCount extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<ButtonResetCount, string> {
    const parsed = buttonResetCountSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid ButtonResetCount');
    return ok(new ButtonResetCount(parsed.data));
  }

  equals(other: ButtonResetCount): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
