import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { RehydratedValueObject } from '../../shared/RehydratedValueObject';

const dbFieldNameSchema = z.string().trim().min(1);

export class DbFieldName extends RehydratedValueObject {
  private constructor(value?: string) {
    super(value);
  }

  static empty(): DbFieldName {
    return new DbFieldName();
  }

  static rehydrate(raw: unknown): Result<DbFieldName, DomainError> {
    const parsed = dbFieldNameSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid DbFieldName' }));
    return ok(new DbFieldName(parsed.data));
  }

  value(): Result<string, DomainError> {
    return this.valueResult('DbFieldName');
  }
}
