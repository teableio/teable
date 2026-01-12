import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const fieldHasErrorSchema = z.boolean().optional().nullable();

export class FieldHasError extends ValueObject {
  private constructor(private readonly value: boolean) {
    super();
  }

  static create(raw: unknown): Result<FieldHasError, DomainError> {
    const parsed = fieldHasErrorSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldHasError' }));
    return ok(new FieldHasError(parsed.data ?? false));
  }

  static from(value: boolean | null | undefined): FieldHasError {
    return value === true ? FieldHasError.error() : FieldHasError.ok();
  }

  static error(): FieldHasError {
    return new FieldHasError(true);
  }

  static ok(): FieldHasError {
    return new FieldHasError(false);
  }

  equals(other: FieldHasError): boolean {
    return this.value === other.value;
  }

  isError(): boolean {
    return this.value === true;
  }

  toBoolean(): boolean {
    return this.value;
  }
}
