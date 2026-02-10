import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const fieldComputedSchema = z.boolean();

export class FieldComputed extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<FieldComputed, DomainError> {
    const parsed = fieldComputedSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldComputed' }));
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
