import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const selectAutoNewOptionsSchema = z.boolean();

export class SelectAutoNewOptions extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<SelectAutoNewOptions, string> {
    const parsed = selectAutoNewOptionsSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid SelectAutoNewOptions');
    return ok(new SelectAutoNewOptions(parsed.data));
  }

  static allow(): SelectAutoNewOptions {
    return new SelectAutoNewOptions(false);
  }

  static prevent(): SelectAutoNewOptions {
    return new SelectAutoNewOptions(true);
  }

  equals(other: SelectAutoNewOptions): boolean {
    return this.value === other.value;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
