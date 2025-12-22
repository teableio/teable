import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { RehydratedValueObject } from '../../../shared/RehydratedValueObject';

const formulaMetaSchema = z.object({
  persistedAsGeneratedColumn: z.boolean().optional().default(false),
});

export type FormulaMetaValue = z.infer<typeof formulaMetaSchema>;

export class FormulaMeta extends RehydratedValueObject {
  private constructor(rawValue?: string) {
    super(rawValue);
  }

  static empty(): FormulaMeta {
    return new FormulaMeta();
  }

  static rehydrate(raw: unknown): Result<FormulaMeta, string> {
    const parsed = formulaMetaSchema.safeParse(raw ?? {});
    if (!parsed.success) return err('Invalid FormulaMeta');
    return ok(new FormulaMeta(JSON.stringify(parsed.data)));
  }

  value(): Result<FormulaMetaValue, string> {
    return this.valueResult('FormulaMeta').andThen((rawValue) => {
      try {
        const parsed = formulaMetaSchema.safeParse(JSON.parse(rawValue));
        if (!parsed.success) return err('Invalid FormulaMeta');
        return ok(parsed.data);
      } catch {
        return err('Invalid FormulaMeta');
      }
    });
  }

  persistedAsGeneratedColumn(): Result<boolean, string> {
    return this.value().map((value) => value.persistedAsGeneratedColumn ?? false);
  }

  toDto(): Result<FormulaMetaValue, string> {
    return this.value().map((value) => ({
      persistedAsGeneratedColumn: value.persistedAsGeneratedColumn ?? false,
    }));
  }
}
