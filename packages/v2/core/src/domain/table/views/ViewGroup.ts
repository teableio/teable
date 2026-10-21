import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';
import type { ViewQueryDefaults } from './ViewQueryDefaults';

export const viewGroupItemSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

export const viewGroupSchema = z.array(viewGroupItemSchema).nullable();

export type ViewGroupItem = z.infer<typeof viewGroupItemSchema>;
export type ViewGroupDTO = z.infer<typeof viewGroupSchema>;

export const viewGroupDtoFromQueryDefaults = (queryDefaults: ViewQueryDefaults): ViewGroupDTO => {
  const group = queryDefaults.group();
  return group === undefined ? null : group.map((item) => ({ ...item }));
};

export class ViewGroup extends ValueObject {
  private constructor(private readonly value: ViewGroupDTO) {
    super();
  }

  static create(raw: unknown): Result<ViewGroup, DomainError> {
    const parsed = viewGroupSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid View group',
          details: z.formatError(parsed.error),
        })
      );
    }
    return ok(new ViewGroup(parsed.data));
  }

  toDto(): ViewGroupDTO {
    return this.value === null ? null : this.value.map((item) => ({ ...item }));
  }

  equals(other: ViewGroup): boolean {
    return JSON.stringify(this.value) === JSON.stringify(other.value);
  }
}
