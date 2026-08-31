import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';
import type { ViewQueryDefaults } from './ViewQueryDefaults';

export const viewSortItemSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

export const viewSortSchema = z
  .object({
    sortObjs: z.array(viewSortItemSchema),
    manualSort: z.boolean().optional(),
  })
  .nullable();

export type ViewSortItem = z.infer<typeof viewSortItemSchema>;
export type ViewSortDTO = z.infer<typeof viewSortSchema>;

export const viewSortDtoFromQueryDefaults = (queryDefaults: ViewQueryDefaults): ViewSortDTO => {
  const sortObjs = queryDefaults.sort();
  const manualSort = queryDefaults.manualSort();
  if (sortObjs === undefined && manualSort === undefined) return null;
  return {
    sortObjs: (sortObjs ?? []).map((item) => ({ ...item })),
    ...(manualSort !== undefined ? { manualSort } : {}),
  };
};

export class ViewSort extends ValueObject {
  private constructor(private readonly value: ViewSortDTO) {
    super();
  }

  static create(raw: unknown): Result<ViewSort, DomainError> {
    const parsed = viewSortSchema.safeParse(raw);
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid View sort',
          details: z.formatError(parsed.error),
        })
      );
    }
    return ok(new ViewSort(parsed.data));
  }

  toDto(): ViewSortDTO {
    if (this.value === null) return null;
    return {
      sortObjs: this.value.sortObjs.map((item) => ({ ...item })),
      ...(this.value.manualSort !== undefined ? { manualSort: this.value.manualSort } : {}),
    };
  }

  equals(other: ViewSort): boolean {
    return JSON.stringify(this.value) === JSON.stringify(other.value);
  }
}
