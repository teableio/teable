import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const selectOptionNameSchema = z.string().trim().min(1).max(255);

export class SelectOptionName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<SelectOptionName, string> {
    const parsed = selectOptionNameSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid SelectOptionName');
    return ok(new SelectOptionName(parsed.data));
  }

  equals(other: SelectOptionName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
