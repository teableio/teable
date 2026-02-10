import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const selectOptionNameSchema = z.string().trim().min(1);

export class SelectOptionName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<SelectOptionName, DomainError> {
    const parsed = selectOptionNameSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => i.message).join(', ');
      return err(
        domainError.validation({
          message: `Invalid SelectOptionName: ${issues}`,
          code: 'validation.field.select_option_name',
          details: { raw, zodErrors: parsed.error.issues },
        })
      );
    }
    return ok(new SelectOptionName(parsed.data));
  }

  equals(other: SelectOptionName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
