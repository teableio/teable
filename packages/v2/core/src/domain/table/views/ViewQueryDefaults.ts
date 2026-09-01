import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

import {
  recordFilterConditionSchema,
  recordFilterConjunctionSchema,
  type RecordFilter,
  type RecordFilterNode,
} from '../../../queries/RecordFilterDto';
import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';
import { viewSortItemSchema, type ViewSortItem } from './ViewSort';
import { ViewSourceFilter, type ViewSourceFilterDTO } from './ViewSourceFilter';

const viewGroupItemSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

const viewRecordFilterNodeSchema: z.ZodType<RecordFilterNode> = z.lazy(() =>
  z.union([
    recordFilterConditionSchema,
    z.object({
      conjunction: recordFilterConjunctionSchema,
      items: z.array(viewRecordFilterNodeSchema),
    }),
    z.object({ not: viewRecordFilterNodeSchema }),
  ])
);

export const viewRecordFilterSchema: z.ZodType<RecordFilter> =
  viewRecordFilterNodeSchema.nullable();

const viewQueryDefaultsSchema = z
  .object({
    filter: viewRecordFilterSchema.optional().nullable(),
    sort: z.array(viewSortItemSchema).optional(),
    group: z.array(viewGroupItemSchema).optional(),
    manualSort: z.boolean().optional(),
  })
  .strict();

export type ViewQuerySortItem = ViewSortItem;
export type ViewQueryGroupItem = z.infer<typeof viewGroupItemSchema>;

export type ViewQueryDefaultsDTO = z.infer<typeof viewQueryDefaultsSchema>;

export class ViewQueryDefaults extends ValueObject {
  private constructor(
    private readonly value: ViewQueryDefaultsDTO,
    private readonly sourceFilterValue?: ViewSourceFilter
  ) {
    super();
  }

  static create(
    raw: ViewQueryDefaultsDTO,
    options?: { sourceFilter?: unknown }
  ): Result<ViewQueryDefaults, DomainError> {
    const parsed = viewQueryDefaultsSchema.safeParse(raw ?? {});
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid ViewQueryDefaults',
          details: z.formatError(parsed.error),
        })
      );
    const sourceFilterResult = ViewQueryDefaults.parseSourceFilter(options?.sourceFilter);
    if (sourceFilterResult.isErr()) return err(sourceFilterResult.error);
    const canonicalResult = ViewQueryDefaults.withCanonicalSourceFilter(
      parsed.data,
      sourceFilterResult.value
    );
    if (canonicalResult.isErr()) return err(canonicalResult.error);
    return ok(new ViewQueryDefaults(canonicalResult.value, sourceFilterResult.value));
  }

  static rehydrate(
    raw: unknown,
    options?: { sourceFilter?: unknown }
  ): Result<ViewQueryDefaults, DomainError> {
    const parsed = viewQueryDefaultsSchema.safeParse(raw ?? {});
    if (!parsed.success)
      return err(
        domainError.validation({
          message: 'Invalid ViewQueryDefaults',
          details: z.formatError(parsed.error),
        })
      );
    const sourceFilterResult = ViewQueryDefaults.parseSourceFilter(options?.sourceFilter);
    if (sourceFilterResult.isErr()) return err(sourceFilterResult.error);
    const canonicalResult = ViewQueryDefaults.withCanonicalSourceFilter(
      parsed.data,
      sourceFilterResult.value
    );
    if (canonicalResult.isErr()) return err(canonicalResult.error);
    return ok(new ViewQueryDefaults(canonicalResult.value, sourceFilterResult.value));
  }

  static empty(): ViewQueryDefaults {
    return new ViewQueryDefaults({});
  }

  filter(): RecordFilter | null | undefined {
    return this.value.filter;
  }

  sourceFilter(): ViewSourceFilterDTO | null | undefined {
    return this.sourceFilterValue?.toDto();
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
    return (
      ViewQueryDefaults.isSameValue(this.value, other.value) &&
      ((this.sourceFilterValue == null && other.sourceFilterValue == null) ||
        (this.sourceFilterValue != null &&
          other.sourceFilterValue != null &&
          this.sourceFilterValue.equals(other.sourceFilterValue)))
    );
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

  private static parseSourceFilter(
    raw: unknown
  ): Result<ViewSourceFilter | undefined, DomainError> {
    if (raw === undefined) return ok(undefined);
    return ViewSourceFilter.create(raw);
  }

  private static withCanonicalSourceFilter(
    value: ViewQueryDefaultsDTO,
    sourceFilter: ViewSourceFilter | undefined
  ): Result<ViewQueryDefaultsDTO, DomainError> {
    if (!sourceFilter) return ok(value);
    const parsed = viewQueryDefaultsSchema.safeParse({
      ...value,
      filter: sourceFilter.toCanonical(),
    });
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid canonical ViewSourceFilter',
          details: z.formatError(parsed.error),
        })
      );
    }
    return ok(parsed.data);
  }
}
