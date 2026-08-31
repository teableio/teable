import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';

const tablePropertiesSchema = z
  .object({
    description: z.string().optional(),
    icon: z.string().emoji().optional(),
  })
  .strict();

export type TablePropertiesValue = z.infer<typeof tablePropertiesSchema>;
export type TablePropertiesPatch = {
  readonly description?: string | null;
  readonly icon?: string | null;
};

export class TableProperties extends ValueObject {
  private constructor(private readonly value: TablePropertiesValue) {
    super();
  }

  static create(raw: unknown): Result<TableProperties, DomainError> {
    const parsed = tablePropertiesSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid TableProperties',
          details: { issues: parsed.error.issues },
        })
      );
    }
    return ok(new TableProperties(parsed.data));
  }

  static empty(): TableProperties {
    return new TableProperties({});
  }

  description(): string | undefined {
    return this.value.description;
  }

  icon(): string | undefined {
    return this.value.icon;
  }

  withPatch(patch: TablePropertiesPatch): Result<TableProperties, DomainError> {
    const next = this.toDto();
    if ('description' in patch) {
      if (patch.description == null) delete next.description;
      else next.description = patch.description;
    }
    if ('icon' in patch) {
      if (patch.icon == null) delete next.icon;
      else next.icon = patch.icon;
    }
    return TableProperties.create(next);
  }

  toDto(): TablePropertiesValue {
    return { ...this.value };
  }

  equals(other: TableProperties): boolean {
    return this.description() === other.description() && this.icon() === other.icon();
  }
}
