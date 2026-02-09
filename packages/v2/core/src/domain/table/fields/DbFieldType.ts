import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { RehydratedValueObject } from '../../shared/RehydratedValueObject';

const dbFieldTypeSchema = z.string().trim().min(1);

export class DbFieldType extends RehydratedValueObject {
  private constructor(value?: string) {
    super(value);
  }

  static empty(): DbFieldType {
    return new DbFieldType();
  }

  static rehydrate(raw: unknown): Result<DbFieldType, DomainError> {
    const parsed = dbFieldTypeSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid DbFieldType' }));
    return ok(new DbFieldType(parsed.data));
  }

  value(): Result<string, DomainError> {
    return this.valueResult('DbFieldType');
  }
}
