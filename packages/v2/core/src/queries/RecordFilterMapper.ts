import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { notSpec } from '../domain/shared/specification/NotSpec';
import { FieldId } from '../domain/table/fields/FieldId';
import type { ITableRecordConditionSpecVisitor } from '../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordConditionSpecBuilder } from '../domain/table/records/specs/RecordConditionSpecBuilder';
import type { RecordConditionValue } from '../domain/table/records/specs/RecordConditionValues';
import {
  RecordConditionDateValue,
  RecordConditionFieldReferenceValue,
  RecordConditionLiteralListValue,
  RecordConditionLiteralValue,
} from '../domain/table/records/specs/RecordConditionValues';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import {
  isRecordFilterCondition,
  isRecordFilterDateValue,
  isRecordFilterFieldReferenceValue,
  isRecordFilterGroup,
  isRecordFilterNot,
  type RecordFilter,
  type RecordFilterNode,
  type RecordFilterValue,
} from './RecordFilterDto';

const resolveField = (table: Table, rawFieldId: string) => {
  return FieldId.create(rawFieldId).andThen((fieldId) =>
    table
      .getField((candidate) => candidate.id().equals(fieldId))
      .mapErr(() => domainError.notFound({ message: 'Filter field not found' }))
  );
};

const buildConditionValue = (
  table: Table,
  rawValue: RecordFilterValue
): Result<RecordConditionValue | undefined, DomainError> => {
  if (rawValue === null) return ok(undefined);

  if (isRecordFilterFieldReferenceValue(rawValue)) {
    return FieldId.create(rawValue.fieldId).andThen((fieldId) => {
      return table
        .getField((candidate) => candidate.id().equals(fieldId))
        .mapErr(() => domainError.notFound({ message: 'Filter field reference not found' }))
        .andThen((field) => {
          if (rawValue.tableId) {
            const tableIdResult = TableId.create(rawValue.tableId);
            if (tableIdResult.isErr()) return err(tableIdResult.error);
            if (!tableIdResult.value.equals(table.id()))
              return err(domainError.unexpected({ message: 'Filter field table mismatch' }));
          }

          return RecordConditionFieldReferenceValue.create(field);
        });
    });
  }

  if (isRecordFilterDateValue(rawValue)) {
    return RecordConditionDateValue.create(rawValue);
  }

  if (Array.isArray(rawValue)) {
    return RecordConditionLiteralListValue.create(rawValue);
  }

  return RecordConditionLiteralValue.create(rawValue);
};

const buildSpecFromNode = (
  table: Table,
  node: RecordFilterNode
): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError> => {
  if (isRecordFilterCondition(node)) {
    return resolveField(table, node.fieldId).andThen((field) =>
      buildConditionValue(table, node.value).andThen((value) =>
        field.spec().create({ operator: node.operator, value })
      )
    );
  }

  if (isRecordFilterNot(node)) {
    return buildSpecFromNode(table, node.not).andThen((spec) => notSpec(spec));
  }

  if (isRecordFilterGroup(node)) {
    const mode = node.conjunction === 'and' ? 'and' : 'or';
    const builder = RecordConditionSpecBuilder.create(mode);
    for (const item of node.items) {
      const childResult = buildSpecFromNode(table, item);
      if (childResult.isErr()) return err(childResult.error);
      builder.addConditionSpec(childResult.value);
    }
    return builder.build();
  }

  return err(domainError.validation({ message: 'Invalid record filter node' }));
};

const sanitizeNode = (
  table: Table,
  node: RecordFilterNode
): Result<RecordFilterNode | null, DomainError> => {
  if (isRecordFilterCondition(node)) {
    const fieldResult = resolveField(table, node.fieldId);
    if (fieldResult.isErr()) return ok(null);

    const valueResult = buildConditionValue(table, node.value);
    if (valueResult.isErr()) return ok(null);

    const specResult = fieldResult.value.spec().create({
      operator: node.operator,
      value: valueResult.value,
    });
    if (specResult.isErr()) return ok(null);

    return ok(node);
  }

  if (isRecordFilterNot(node)) {
    return sanitizeNode(table, node.not).map((sanitized) =>
      sanitized ? { not: sanitized } : null
    );
  }

  if (isRecordFilterGroup(node)) {
    const items: RecordFilterNode[] = [];
    for (const item of node.items) {
      const sanitized = sanitizeNode(table, item);
      if (sanitized.isErr()) return err(sanitized.error);
      if (sanitized.value) {
        items.push(sanitized.value);
      }
    }

    if (items.length === 0) {
      return ok(null);
    }

    return ok({
      conjunction: node.conjunction,
      items,
    });
  }

  return err(domainError.validation({ message: 'Invalid record filter node' }));
};

export const buildRecordConditionSpec = (
  table: Table,
  filter: RecordFilter
): Result<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>, DomainError> => {
  if (!filter) return err(domainError.validation({ message: 'Filter is empty' }));
  return buildSpecFromNode(table, filter);
};

export const sanitizeRecordFilter = (
  table: Table,
  filter: RecordFilter | null | undefined
): Result<RecordFilter | null | undefined, DomainError> => {
  if (filter === undefined || filter === null) {
    return ok(filter);
  }

  return sanitizeNode(table, filter).map((sanitized) => sanitized ?? null);
};

export const buildSanitizedRecordConditionSpec = (
  table: Table,
  filter: RecordFilter | null | undefined
): Result<
  ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
  DomainError
> => {
  return sanitizeRecordFilter(table, filter).andThen((sanitized) =>
    sanitized ? buildRecordConditionSpec(table, sanitized) : ok(undefined)
  );
};
