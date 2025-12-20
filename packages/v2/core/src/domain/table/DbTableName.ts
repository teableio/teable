import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { RehydratedValueObject } from '../shared/RehydratedValueObject';

const dbTableNameSchema = z.string().trim().min(1).max(255);

export class DbTableName extends RehydratedValueObject {
  private constructor(value?: string) {
    super(value);
  }

  static empty(): DbTableName {
    return new DbTableName();
  }

  static rehydrate(raw: unknown): Result<DbTableName, string> {
    const parsed = dbTableNameSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid DbTableName');
    return ok(new DbTableName(parsed.data));
  }

  value(): Result<string, string> {
    return this.valueResult('DbTableName');
  }

  split(options?: { defaultSchema?: string | null }): Result<
    {
      schema: string | null;
      tableName: string;
    },
    string
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
