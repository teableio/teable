import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { Field } from '../domain/table/fields/Field';
import type { FieldId } from '../domain/table/fields/FieldId';
import { FieldType } from '../domain/table/fields/FieldType';
import { CellValueType } from '../domain/table/fields/types/CellValueType';
import { FieldValueTypeVisitor } from '../domain/table/fields/visitors/FieldValueTypeVisitor';
import { getValidRecordConditionOperators } from '../domain/table/records/specs/RecordConditionOperators';
import type { Table } from '../domain/table/Table';
import {
  isRecordFilterGroup,
  type RecordFilter,
  type RecordFilterCondition,
} from './RecordFilterDto';

/**
 * V1-compatible record search input.
 *
 * Semantics:
 * - `[value]`: search all visible fields, highlight only
 * - `[value, fieldKeys]`: search the specified comma-separated field keys, highlight only
 * - `[value, fieldKeys, hideNotMatchRow]`: same search, optionally filtering visible rows
 */
export const recordSearchInputSchema = z
  .union([
    z.tuple([z.string()]),
    z.tuple([z.string(), z.string()]),
    z.tuple([z.string(), z.string(), z.boolean()]),
  ])
  .optional();

export type RecordSearchInput = Exclude<z.output<typeof recordSearchInputSchema>, undefined>;

export interface RecordQuerySearch {
  readonly search: RecordSearch;
  readonly visibleFieldIds?: ReadonlyArray<FieldId>;
}

const fieldValueTypeVisitor = new FieldValueTypeVisitor();

export const mergeRecordFiltersWithAnd = (
  filter: RecordFilter | undefined,
  searchFilter: RecordFilter | undefined
): RecordFilter | undefined => {
  if (!searchFilter) {
    return filter;
  }

  if (!filter) {
    return searchFilter;
  }

  if (isRecordFilterGroup(filter) && filter.conjunction === 'and') {
    return { ...filter, items: [...filter.items, searchFilter] };
  }

  return {
    conjunction: 'and',
    items: [filter, searchFilter],
  };
};

export const resolveVisibleRowSearch = (
  search: RecordSearch | undefined,
  visibleFieldIds?: ReadonlyArray<FieldId>
): RecordQuerySearch | undefined => {
  if (!search?.affectsVisibleRows() || search.value.length === 0) {
    return undefined;
  }

  return {
    search,
    visibleFieldIds,
  };
};

export class RecordSearch {
  private readonly fieldKeysValue: ReadonlyArray<string> | undefined;

  private constructor(
    readonly value: string,
    rawFieldKeys: string | undefined,
    readonly hideNotMatchRow: boolean
  ) {
    const parsedFieldKeys = rawFieldKeys
      ?.split(',')
      .map((fieldKey) => fieldKey.trim())
      .filter(Boolean);

    this.fieldKeysValue = parsedFieldKeys?.length ? parsedFieldKeys : undefined;
  }

  static fromTuple(search: RecordSearchInput): RecordSearch {
    const [value, rawFieldKeys, hideNotMatchRow] = search;
    return new RecordSearch(value, rawFieldKeys, hideNotMatchRow ?? false);
  }

  static fromOptionalTuple(search: RecordSearchInput | undefined): RecordSearch | undefined {
    return search ? RecordSearch.fromTuple(search) : undefined;
  }

  fieldKeys(): ReadonlyArray<string> | undefined {
    return this.fieldKeysValue;
  }

  searchesAllFields(): boolean {
    return !this.fieldKeysValue?.length;
  }

  affectsVisibleRows(): boolean {
    return this.hideNotMatchRow;
  }

  resolveFields(
    table: Table,
    options?: { visibleFieldIds?: ReadonlyArray<FieldId> }
  ): Result<ReadonlyArray<Field>, DomainError> {
    const visibleFieldIds = options?.visibleFieldIds;
    const visibleFieldIdSet = visibleFieldIds
      ? new Set(visibleFieldIds.map((fieldId) => fieldId.toString()))
      : undefined;
    const filterVisibleField = (field: Field) =>
      !visibleFieldIdSet || visibleFieldIdSet.has(field.id().toString());

    if (this.searchesAllFields()) {
      if (!visibleFieldIds) {
        return ok(table.getFields().filter(filterVisibleField));
      }

      const fieldsById = new Map(
        table.getFields().map((field) => [field.id().toString(), field] as const)
      );

      return ok(
        visibleFieldIds
          .map((fieldId) => fieldsById.get(fieldId.toString()))
          .filter((field): field is Field => Boolean(field))
          .filter(filterVisibleField)
      );
    }

    const resolvedFields = new Map<string, Field>();

    for (const fieldKey of this.fieldKeysValue ?? []) {
      const fieldResult = this.resolveField(table, fieldKey);
      if (fieldResult.isErr()) {
        return err(fieldResult.error);
      }

      const field = fieldResult.value;
      if (!filterVisibleField(field)) {
        continue;
      }

      resolvedFields.set(field.id().toString(), field);
    }

    return ok([...resolvedFields.values()]);
  }

  buildHideNotMatchFilter(
    table: Table,
    options?: { visibleFieldIds?: ReadonlyArray<FieldId> }
  ): Result<RecordFilter | undefined, DomainError> {
    if (!this.affectsVisibleRows()) {
      return ok(undefined);
    }

    const resolvedFieldsResult = this.resolveFields(table, options);
    if (resolvedFieldsResult.isErr()) {
      return err(resolvedFieldsResult.error);
    }

    const searchConditions: RecordFilterCondition[] = [];

    for (const field of resolvedFieldsResult.value) {
      const conditionResult = this.buildFieldCondition(field);
      if (conditionResult.isErr()) {
        return err(conditionResult.error);
      }

      if (conditionResult.value) {
        searchConditions.push(conditionResult.value);
      }
    }

    if (!searchConditions.length) {
      return ok(undefined);
    }

    if (searchConditions.length === 1) {
      return ok(searchConditions[0]);
    }

    return ok({
      conjunction: 'or',
      items: searchConditions,
    });
  }

  private resolveField(table: Table, fieldKey: string): Result<Field, DomainError> {
    const field = table.getFields().find((candidate) => this.matchesFieldKey(candidate, fieldKey));

    if (!field) {
      return err(
        domainError.notFound({
          message: `Field not found: ${fieldKey}`,
          details: { fieldKey },
        })
      );
    }

    return ok(field);
  }

  private buildFieldCondition(
    field: Field
  ): Result<RecordFilterCondition | undefined, DomainError> {
    const supportedResult = this.supportsHideNotMatchField(field);
    if (supportedResult.isErr()) {
      return err(supportedResult.error);
    }

    if (!supportedResult.value) {
      return ok(undefined);
    }

    return ok({
      fieldId: field.id().toString(),
      operator: 'contains',
      value: this.value,
    });
  }

  private supportsHideNotMatchField(field: Field): Result<boolean, DomainError> {
    if (field.type().equals(FieldType.button())) {
      return ok(false);
    }

    const valueTypeResult = field.accept(fieldValueTypeVisitor);
    if (valueTypeResult.isErr()) {
      return err(valueTypeResult.error);
    }

    if (
      this.searchesAllFields() &&
      valueTypeResult.value.cellValueType.equals(CellValueType.dateTime())
    ) {
      return ok(false);
    }

    return ok(getValidRecordConditionOperators(field, valueTypeResult.value).includes('contains'));
  }

  private matchesFieldKey(field: Field, fieldKey: string): boolean {
    if (field.id().toString() === fieldKey || field.name().toString() === fieldKey) {
      return true;
    }

    const dbFieldNameResult = field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
    return dbFieldNameResult.isOk() && dbFieldNameResult.value === fieldKey;
  }
}
