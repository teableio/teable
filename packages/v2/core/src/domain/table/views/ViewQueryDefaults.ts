import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import { recordFilterSchema, type RecordFilter } from '../../../queries/RecordFilterDto';
import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewSortItemSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

const viewGroupItemSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

const viewQueryDefaultsSchema = z
  .object({
    filter: recordFilterSchema.optional().nullable(),
    sort: z.array(viewSortItemSchema).optional(),
    group: z.array(viewGroupItemSchema).optional(),
    manualSort: z.boolean().optional(),
  })
  .strict();

export type ViewQuerySortItem = z.infer<typeof viewSortItemSchema>;
export type ViewQueryGroupItem = z.infer<typeof viewGroupItemSchema>;

export type ViewQueryDefaultsDTO = z.infer<typeof viewQueryDefaultsSchema>;

export class ViewQueryDefaults extends ValueObject {
  private constructor(private readonly value: ViewQueryDefaultsDTO) {
    super();
  }

  static create(raw: ViewQueryDefaultsDTO): Result<ViewQueryDefaults, DomainError> {
    const parsed = viewQueryDefaultsSchema.safeParse(raw ?? {});
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid ViewQueryDefaults',
          details: z.formatError(parsed.error),
        })
      );
    return ok(new ViewQueryDefaults(parsed.data));
  }

  static rehydrate(raw: unknown): Result<ViewQueryDefaults, DomainError> {
    const parsed = viewQueryDefaultsSchema.safeParse(raw ?? {});
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid ViewQueryDefaults',
          details: z.formatError(parsed.error),
        })
      );
    return ok(new ViewQueryDefaults(parsed.data));
  }

  static empty(): ViewQueryDefaults {
    return new ViewQueryDefaults({});
  }

  filter(): RecordFilter | null | undefined {
    return this.value.filter;
  }

  sort(): ReadonlyArray<ViewQuerySortItem> | undefined {
    return this.value.sort ? [...this.value.sort] : undefined;
  }

  group(): ReadonlyArray<ViewQueryGroupItem> | undefined {
    return this.value.group ? [...this.value.group] : undefined;
  }

  manualSort(): boolean | undefined {
    return this.value.manualSort;
  }

  toDto(): ViewQueryDefaultsDTO {
    return ViewQueryDefaults.cloneValue(this.value);
  }

  equals(other: ViewQueryDefaults): boolean {
    return ViewQueryDefaults.isSameValue(this.value, other.value);
  }

  merge(params: {
    filter?: RecordFilter | null;
    sort?: ReadonlyArray<ViewQuerySortItem>;
    group?: ReadonlyArray<ViewQueryGroupItem>;
  }): ViewQueryDefaults {
    const mergedFilter = ViewQueryDefaults.mergeFilter(this.value.filter, params.filter);
    const mergedSort = ViewQueryDefaults.mergeSort(
      this.value.sort,
      this.value.manualSort,
      params.sort
    );
    const mergedGroup = ViewQueryDefaults.mergeGroup(this.value.group, params.group);
    return new ViewQueryDefaults({
      filter: mergedFilter,
      ...(mergedSort ? { sort: [...mergedSort] } : {}),
      ...(mergedGroup ? { group: [...mergedGroup] } : {}),
      manualSort: this.value.manualSort,
    });
  }

  private static mergeFilter(
    defaultFilter?: RecordFilter | null,
    queryFilter?: RecordFilter | null
  ): RecordFilter | null | undefined {
    if (queryFilter === null) return null;
    if (queryFilter === undefined) return defaultFilter;
    if (!defaultFilter) return queryFilter;
    return { conjunction: 'and', items: [defaultFilter, queryFilter] };
  }

  private static mergeSort(
    defaultSort?: ReadonlyArray<ViewQuerySortItem>,
    manualSort?: boolean,
    querySort?: ReadonlyArray<ViewQuerySortItem>
  ): ReadonlyArray<ViewQuerySortItem> | undefined {
    if (!defaultSort && !querySort) {
      return undefined;
    }
    if (manualSort && (!querySort || querySort.length === 0)) {
      return [];
    }
    if (!defaultSort || defaultSort.length === 0) {
      return querySort ? [...querySort] : undefined;
    }
    if (!querySort || querySort.length === 0) {
      return [...defaultSort];
    }
    const map = new Map(querySort.map((item) => [item.fieldId, item]));
    defaultSort.forEach((item) => {
      if (!map.has(item.fieldId)) map.set(item.fieldId, item);
    });
    return Array.from(map.values());
  }

  private static mergeGroup(
    defaultGroup?: ReadonlyArray<ViewQueryGroupItem>,
    queryGroup?: ReadonlyArray<ViewQueryGroupItem>
  ): ReadonlyArray<ViewQueryGroupItem> | undefined {
    if (!defaultGroup && !queryGroup) return undefined;
    if (!queryGroup || queryGroup.length === 0) {
      return defaultGroup ? [...defaultGroup] : undefined;
    }
    return [...queryGroup];
  }

  private static cloneValue(value: ViewQueryDefaultsDTO): ViewQueryDefaultsDTO {
    return {
      ...(value.filter !== undefined ? { filter: value.filter } : {}),
      ...(value.sort ? { sort: value.sort.map((item) => ({ ...item })) } : {}),
      ...(value.group ? { group: value.group.map((item) => ({ ...item })) } : {}),
      ...(value.manualSort !== undefined ? { manualSort: value.manualSort } : {}),
    };
  }

  private static isSameValue(left: ViewQueryDefaultsDTO, right: ViewQueryDefaultsDTO): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
