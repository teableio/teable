import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { RehydratedValueObject } from '../../shared/RehydratedValueObject';

const dbFieldNameSchema = z.string().trim().min(1).max(255);

export class DbFieldName extends RehydratedValueObject {
  private constructor(value?: string) {
    super(value);
  }

  static empty(): DbFieldName {
    return new DbFieldName();
  }

  static rehydrate(raw: unknown): Result<DbFieldName, string> {
    const parsed = dbFieldNameSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid DbFieldName');
    return ok(new DbFieldName(parsed.data));
  }

  value(): Result<string, string> {
    return this.valueResult('DbFieldName');
  }
}
