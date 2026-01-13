import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { RehydratedValueObject } from '../../../shared/RehydratedValueObject';

const generatedColumnMetaSchema = z.object({
  persistedAsGeneratedColumn: z.boolean().optional().default(false),
});

export type GeneratedColumnMetaValue = z.infer<typeof generatedColumnMetaSchema>;

export class GeneratedColumnMeta extends RehydratedValueObject {
  private constructor(rawValue?: string) {
    super(rawValue);
  }

  static empty(): GeneratedColumnMeta {
    return new GeneratedColumnMeta();
  }

  static rehydrate(raw: unknown): Result<GeneratedColumnMeta, DomainError> {
    const parsed = generatedColumnMetaSchema.safeParse(raw ?? {});
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid GeneratedColumnMeta' }));
    return ok(new GeneratedColumnMeta(JSON.stringify(parsed.data)));
  }

  value(): Result<GeneratedColumnMetaValue, DomainError> {
    return this.valueResult('GeneratedColumnMeta').andThen((rawValue) => {
      try {
        const parsed = generatedColumnMetaSchema.safeParse(JSON.parse(rawValue));
        if (!parsed.success)
          return err(domainError.validation({ message: 'Invalid GeneratedColumnMeta' }));
        return ok(parsed.data);
      } catch {
        return err(domainError.validation({ message: 'Invalid GeneratedColumnMeta' }));
      }
    });
  }

  persistedAsGeneratedColumn(): Result<boolean, DomainError> {
    return this.value().map((value) => value.persistedAsGeneratedColumn ?? false);
  }

  toDto(): Result<GeneratedColumnMetaValue, DomainError> {
    return this.value().map((value) => ({
      persistedAsGeneratedColumn: value.persistedAsGeneratedColumn ?? false,
    }));
  }
}
