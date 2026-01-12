import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { RehydratedValueObject } from '../shared/RehydratedValueObject';

const dbTableNameSchema = z.string().trim().min(1);

export class DbTableName extends RehydratedValueObject {
  private constructor(value?: string) {
    super(value);
  }

  static empty(): DbTableName {
    return new DbTableName();
  }

  static rehydrate(raw: unknown): Result<DbTableName, DomainError> {
    const parsed = dbTableNameSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid DbTableName' }));
    return ok(new DbTableName(parsed.data));
  }

  value(): Result<string, DomainError> {
    return this.valueResult('DbTableName');
  }

  split(options?: { defaultSchema?: string | null }): Result<
    {
      schema: string | null;
      tableName: string;
    },
    DomainError
  > {
    return this.value().map((raw) => {
      const dotIndex = raw.indexOf('.');
      if (dotIndex === -1) {
        return { schema: options?.defaultSchema ?? null, tableName: raw };
      }
      return { schema: raw.slice(0, dotIndex), tableName: raw.slice(dotIndex + 1) };
    });
  }
}
