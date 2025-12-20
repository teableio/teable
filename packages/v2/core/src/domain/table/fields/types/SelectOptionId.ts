import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { generatePrefixedId } from '../../../shared/IdGenerator';
import { ValueObject } from '../../../shared/ValueObject';

const selectOptionIdSchema = z.string().min(1);

const selectOptionIdPrefix = 'cho';
const selectOptionIdBodyLength = 8;

export class SelectOptionId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<SelectOptionId, string> {
    const parsed = selectOptionIdSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid SelectOptionId');
    return ok(new SelectOptionId(parsed.data));
  }

  static generate(): Result<SelectOptionId, string> {
    try {
      return ok(
        new SelectOptionId(generatePrefixedId(selectOptionIdPrefix, selectOptionIdBodyLength))
      );
    } catch {
      return err('Failed to generate SelectOptionId');
    }
  }

  equals(other: SelectOptionId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
