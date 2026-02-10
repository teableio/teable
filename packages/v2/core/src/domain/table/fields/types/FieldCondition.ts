import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import type { ISpecification } from '../../../shared/specification/ISpecification';
import { ValueObject } from '../../../shared/ValueObject';
import type { ITableRecordConditionSpecVisitor } from '../../records/specs/ITableRecordConditionSpecVisitor';
import {
  recordConditionOperatorSchema,
  type RecordConditionOperator,
} from '../../records/specs/RecordConditionOperators';
import { RecordConditionSpecBuilder } from '../../records/specs/RecordConditionSpecBuilder';
import {
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
  type RecordConditionValue,
} from '../../records/specs/RecordConditionValues';
import type { TableRecord } from '../../records/TableRecord';
import type { Table } from '../../Table';
import { FieldId } from '../FieldId';

/**
 * Represents a single filter item in a condition.
 */
export type FilterItemValue = {
  fieldId: string;
  operator: RecordConditionOperator;
  value?: unknown;
};

/**
 * Sort configuration for a condition.
 */
export type ConditionSortValue = {
  fieldId: string;
  order: 'asc' | 'desc';
};

/**
 * DTO format for FieldCondition, compatible with v1 IFilter format.
 */
export type FieldConditionDTO = {
  filter?: IFilterDTO | null;
  sort?: ConditionSortValue;
  limit?: number;
};

/**
 * v1 IFilter compatible format.
 */
export type IFilterDTO = {
  conjunction: 'and' | 'or';
  filterSet: (IFilterItemDTO | IFilterDTO)[];
};

/**
 * v1 IFilterItem compatible format.
 */
export type IFilterItemDTO = {
  fieldId: string;
  operator: string;
  value?: unknown;
  isSymbol?: boolean;
};

const conditionSortSchema = z.object({
  fieldId: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

const filterItemSchema = z.object({
  fieldId: z.string().min(1),
  operator: z.string().min(1),
  value: z.unknown().optional(),
  isSymbol: z.boolean().optional(),
});

const baseFilterSetSchema = z.object({
  conjunction: z.enum(['and', 'or']),
});

type FilterSetType = z.infer<typeof baseFilterSetSchema> & {
  filterSet: (z.infer<typeof filterItemSchema> | FilterSetType)[];
};

const nestedFilterSchema: z.ZodType<FilterSetType> = baseFilterSetSchema.extend({
  filterSet: z.lazy(() => z.union([filterItemSchema, nestedFilterSchema]).array()),
});

const fieldConditionDtoSchema = z.object({
  filter: nestedFilterSchema.nullable().optional(),
  sort: conditionSortSchema.optional(),
  limit: z.number().int().positive().optional(),
});

/**
 * Internal representation of a filter item.
 */
type FilterItem = {
  fieldId: FieldId;
  operator: RecordConditionOperator;
  value?: unknown;
  /**
   * When true, the value is a field ID reference (column-to-column comparison).
   * This allows conditions like "field1 = field2".
   */
  isSymbol?: boolean;
};

/**
 * Internal representation of sort configuration.
 */
class ConditionSort extends ValueObject {
  private constructor(
    private readonly fieldIdValue: FieldId,
    private readonly orderValue: 'asc' | 'desc'
  ) {
    super();
  }

  static create(value: unknown): Result<ConditionSort, DomainError> {
    const parsed = conditionSortSchema.safeParse(value);
    if (!parsed.success) {
      return err(domainError.validation({ message: 'Invalid ConditionSort' }));
    }

    return FieldId.create(parsed.data.fieldId).map(
      (fieldId) => new ConditionSort(fieldId, parsed.data.order)
    );
  }

  fieldId(): FieldId {
    return this.fieldIdValue;
  }

  order(): 'asc' | 'desc' {
    return this.orderValue;
  }

  toDto(): ConditionSortValue {
    return {
      fieldId: this.fieldIdValue.toString(),
      order: this.orderValue,
    };
  }

  equals(other: ConditionSort): boolean {
    return this.fieldIdValue.equals(other.fieldIdValue) && this.orderValue === other.orderValue;
  }
}

/**
 * FieldCondition value object for conditional field configuration.
 *
 * Encapsulates filter/sort/limit configuration that can be converted to RecordConditionSpec.
 * Compatible with v1 IFilter DTO format for seamless migration.
 *
 * This abstraction is shared between:
 * - ConditionalRollupField
 * - ConditionalLookupField
 * - View filter (future)
 */
export class FieldCondition extends ValueObject {
  private constructor(
    private readonly filterItemsValue: ReadonlyArray<FilterItem>,
    private readonly conjunctionValue: 'and' | 'or',
    private readonly sortValue: ConditionSort | undefined,
    private readonly limitValue: number | undefined,
    private readonly rawFilterValue: IFilterDTO | null | undefined
  ) {
    super();
  }

  /**
   * Creates a FieldCondition from a raw DTO (compatible with v1 IFilter format).
   */
  static create(dto: unknown): Result<FieldCondition, DomainError> {
    const parsed = fieldConditionDtoSchema.safeParse(dto);
    if (!parsed.success) {
      return err(
        domainError.validation({
          code: 'field.condition.invalid',
          message: 'Invalid FieldCondition',
          details: { issues: parsed.error.issues },
        })
      );
    }

    const { filter, sort, limit } = parsed.data;

    // Parse filter into flat FilterItems
    let filterItems: FilterItem[] = [];
    let conjunction: 'and' | 'or' = 'and';

    if (filter) {
      const parseResult = FieldCondition.parseV1Filter(filter);
      if (parseResult.isErr()) return err(parseResult.error);
      filterItems = parseResult.value.items;
      conjunction = parseResult.value.conjunction;
    }

    // Parse sort
    let sortVO: ConditionSort | undefined;
    if (sort) {
      const sortResult = ConditionSort.create(sort);
      if (sortResult.isErr()) return err(sortResult.error);
      sortVO = sortResult.value;
    }

    return ok(new FieldCondition(filterItems, conjunction, sortVO, limit, filter));
  }

  /**
   * Creates an empty FieldCondition (no filter, sort, or limit).
   */
  static empty(): FieldCondition {
    return new FieldCondition([], 'and', undefined, undefined, null);
  }

  /**
   * Parses v1 IFilter format into a flat array of FilterItems.
   */
  private static parseV1Filter(
    filter: IFilterDTO
  ): Result<{ items: FilterItem[]; conjunction: 'and' | 'or' }, DomainError> {
    const items: FilterItem[] = [];

    for (const entry of filter.filterSet) {
      if ('fieldId' in entry && !('filterSet' in entry)) {
        // This is a filter item
        const filterItemEntry = entry as IFilterItemDTO;

        const fieldIdResult = FieldId.create(filterItemEntry.fieldId);
        if (fieldIdResult.isErr()) return err(fieldIdResult.error);

        const operatorResult = recordConditionOperatorSchema.safeParse(filterItemEntry.operator);
        if (!operatorResult.success) {
          return err(
            domainError.validation({
              code: 'field.condition.invalid_operator',
              message: `Invalid operator: ${filterItemEntry.operator}`,
            })
          );
        }

        items.push({
          fieldId: fieldIdResult.value,
          operator: operatorResult.data,
          value: filterItemEntry.value,
          ...(filterItemEntry.isSymbol !== undefined && { isSymbol: filterItemEntry.isSymbol }),
        });
      } else if ('filterSet' in entry) {
        // This is a nested filter - recursively parse
        const nestedResult = FieldCondition.parseV1Filter(entry as IFilterDTO);
        if (nestedResult.isErr()) return err(nestedResult.error);
        items.push(...nestedResult.value.items);
      }
    }

    return ok({ items, conjunction: filter.conjunction });
  }

  /**
   * Returns the filter items as internal representation.
   */
  filterItems(): ReadonlyArray<{
    fieldId: FieldId;
    operator: RecordConditionOperator;
    value?: unknown;
    isSymbol?: boolean;
  }> {
    return this.filterItemsValue;
  }

  /**
   * Returns the conjunction type ('and' or 'or').
   */
  conjunction(): 'and' | 'or' {
    return this.conjunctionValue;
  }

  /**
   * Returns the sort configuration, if any.
   */
  sort(): ConditionSort | undefined {
    return this.sortValue;
  }

  /**
   * Returns the limit value, if any.
   */
  limit(): number | undefined {
    return this.limitValue;
  }

  /**
   * Returns true if this condition has any filter items.
   */
  hasFilter(): boolean {
    return this.filterItemsValue.length > 0;
  }

  /**
   * Returns true if this condition has a sort configuration.
   */
  hasSort(): boolean {
    return this.sortValue !== undefined;
  }

  /**
   * Returns true if this condition has a limit value.
   */
  hasLimit(): boolean {
    return this.limitValue !== undefined;
  }

  /**
   * Returns true if this condition is empty (no filter, sort, or limit).
   */
  isEmpty(): boolean {
    return !this.hasFilter() && !this.hasSort() && !this.hasLimit();
  }

  /**
   * Returns the field IDs referenced by filter items.
   */
  filterFieldIds(): ReadonlyArray<FieldId> {
    return this.filterItemsValue.map((item) => item.fieldId);
  }

  /**
   * Converts this FieldCondition to a DTO format.
   */
  toDto(): FieldConditionDTO {
    // Return the raw filter value to preserve nested structure
    // (reconstructing from filterItemsValue would lose nesting)
    return {
      filter: this.rawFilterValue,
      sort: this.sortValue?.toDto(),
      limit: this.limitValue,
    };
  }

  equals(other: FieldCondition): boolean {
    if (this.conjunctionValue !== other.conjunctionValue) return false;
    if (this.limitValue !== other.limitValue) return false;

    // Compare sort
    if (this.sortValue && other.sortValue) {
      if (!this.sortValue.equals(other.sortValue)) return false;
    } else if (this.sortValue !== other.sortValue) {
      return false;
    }

    // Compare filter items
    if (this.filterItemsValue.length !== other.filterItemsValue.length) return false;
    for (let i = 0; i < this.filterItemsValue.length; i++) {
      const a = this.filterItemsValue[i];
      const b = other.filterItemsValue[i];
      if (!a.fieldId.equals(b.fieldId)) return false;
      if (a.operator !== b.operator) return false;
      // Deep compare values (simple JSON comparison)
      if (JSON.stringify(a.value) !== JSON.stringify(b.value)) return false;
    }

    return true;
  }

  /**
   * Converts this FieldCondition to a RecordConditionSpec.
   *
   * This is the canonical way to use conditions - via the visitor pattern.
   * The resulting spec can be translated to SQL or evaluated in-memory via visitors.
   *
   * @param table The table containing the fields referenced in the condition filters (typically the foreign table).
   * @param hostTable Optional host table for resolving field references when isSymbol is true. If not provided, references are resolved from the main table.
   * @returns A RecordConditionSpec that can be used with ITableRecordConditionSpecVisitor.
   */
  toRecordConditionSpec(
    table: Table,
    hostTable?: Table
  ): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | null, DomainError> {
    if (this.filterItemsValue.length === 0) {
      return ok(null);
    }

    // Use reconstructed filter from toDto() to ensure isSymbol is preserved
    const filter = this.toDto().filter;
    if (!filter) {
      return ok(null);
    }

    const fields = table.getFields();
    const hostFields = hostTable?.getFields() ?? fields;
    const buildSpecFromFilter = (
      filter: IFilterDTO
    ): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError> =>
      safeTry<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError>(
        function* () {
          const builder = RecordConditionSpecBuilder.create(filter.conjunction);

          for (const entry of filter.filterSet) {
            if ('filterSet' in entry) {
              const nestedSpec = yield* buildSpecFromFilter(entry as IFilterDTO);
              builder.addConditionSpec(nestedSpec);
              continue;
            }

            const filterItemEntry = entry as IFilterItemDTO;
            const operatorResult = recordConditionOperatorSchema.safeParse(
              filterItemEntry.operator
            );
            if (!operatorResult.success) {
              return err(
                domainError.validation({
                  code: 'field.condition.invalid_operator',
                  message: `Invalid operator: ${filterItemEntry.operator}`,
                })
              );
            }

            const fieldIdResult = FieldId.create(filterItemEntry.fieldId);
            if (fieldIdResult.isErr()) return err(fieldIdResult.error);
            const field = fields.find((f) => f.id().equals(fieldIdResult.value));
            if (!field) {
              return err(
                domainError.notFound({
                  code: 'field.condition.field_not_found',
                  message: `Field not found: ${filterItemEntry.fieldId}`,
                  details: { fieldId: filterItemEntry.fieldId },
                })
              );
            }

            let conditionValue: RecordConditionValue | undefined;
            // `value: null` is commonly used by v1-style filters for operators that don't require a value
            // (e.g. `isEmpty`, `isNotEmpty`). Treat null the same as "not provided".
            if (filterItemEntry.value !== undefined && filterItemEntry.value !== null) {
              // Check if value is a field reference object: { type: 'field', fieldId: ... }
              const isFieldRefObject =
                typeof filterItemEntry.value === 'object' &&
                filterItemEntry.value !== null &&
                'type' in filterItemEntry.value &&
                (filterItemEntry.value as { type?: string }).type === 'field' &&
                'fieldId' in filterItemEntry.value;

              if (filterItemEntry.isSymbol || isFieldRefObject) {
                // Field reference - resolve from host table if provided, otherwise from main table
                const refFieldIdValue = isFieldRefObject
                  ? (filterItemEntry.value as { fieldId: string }).fieldId
                  : String(filterItemEntry.value);
                const refFieldId = yield* FieldId.create(refFieldIdValue);
                const refField = hostFields.find((f) => f.id().equals(refFieldId));
                if (!refField) {
                  return err(
                    domainError.notFound({
                      code: 'field.condition.reference_field_not_found',
                      message: `Reference field not found: ${refFieldIdValue}`,
                      details: { fieldId: refFieldIdValue },
                    })
                  );
                }
                conditionValue = yield* RecordConditionFieldReferenceValue.create(refField);
              } else if (Array.isArray(filterItemEntry.value)) {
                conditionValue = yield* RecordConditionLiteralListValue.create(
                  filterItemEntry.value
                );
              } else {
                conditionValue = yield* RecordConditionLiteralValue.create(filterItemEntry.value);
              }
            }

            builder.addCondition({
              field,
              operator: operatorResult.data,
              value: conditionValue,
            });
          }

          return builder.build();
        }
      );

    return buildSpecFromFilter(filter);
  }
}
