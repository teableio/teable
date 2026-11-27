import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Field } from '../../domain/table/fields/Field';
import type { Table } from '../../domain/table/Table';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import {
  FieldDisplayValueVisitor,
  type FieldDisplayValueFormatter,
} from './FieldDisplayValueVisitor';

/** Presentation runs only after permission masking and response projection. */
export const presentRecordReadModels = (
  table: Table,
  records: ReadonlyArray<TableRecordReadModel>,
  cellFormat: 'json' | 'text'
): Result<ReadonlyArray<TableRecordReadModel>, DomainError> => {
  if (!records.length) {
    return ok([]);
  }

  const visitor = new FieldDisplayValueVisitor();
  const primaryFieldId = table.primaryFieldId().toString();
  const presented: TableRecordReadModel[] = new Array(records.length);

  if (cellFormat === 'json') {
    const primaryField = table
      .getFields()
      .find((field) => field.id().toString() === primaryFieldId);
    const primaryFormatterResult = primaryField?.accept(visitor);
    let primaryFormatter: FieldDisplayValueFormatter | undefined;

    for (let i = 0; i < records.length; i++) {
      const record = records[i]!;
      const primaryValue = record.fields[primaryFieldId];
      if (primaryValue == null || !primaryFormatterResult) {
        presented[i] = record;
        continue;
      }
      if (!primaryFormatter) {
        if (primaryFormatterResult.isErr()) return err(primaryFormatterResult.error);
        primaryFormatter = primaryFormatterResult.value;
      }
      const formattedName = primaryFormatter(primaryValue);
      if (formattedName.isErr()) return err(formattedName.error);
      const name = formattedName.value;
      presented[i] = name != null ? { ...record, name: String(name) } : record;
    }
    return ok(presented);
  }

  const fieldsById = new Map<string, Field>();
  for (const field of table.getFields()) {
    fieldsById.set(field.id().toString(), field);
  }
  const resolvedFormatters = new Map<string, FieldDisplayValueFormatter>();

  const resolveFormatter = (
    fieldId: string
  ): Result<FieldDisplayValueFormatter | undefined, DomainError> => {
    const cached = resolvedFormatters.get(fieldId);
    if (cached) return ok(cached);
    const field = fieldsById.get(fieldId);
    if (!field) return ok(undefined);
    const formatterResult = field.accept(visitor);
    if (formatterResult.isErr()) return err(formatterResult.error);
    resolvedFormatters.set(fieldId, formatterResult.value);
    return ok(formatterResult.value);
  };

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    let name: unknown;
    const primaryValue = record.fields[primaryFieldId];
    if (primaryValue != null) {
      const primaryFormatterRes = resolveFormatter(primaryFieldId);
      if (primaryFormatterRes.isErr()) return err(primaryFormatterRes.error);
      if (primaryFormatterRes.value) {
        const formattedName = primaryFormatterRes.value(primaryValue);
        if (formattedName.isErr()) return err(formattedName.error);
        name = formattedName.value;
      }
    }

    const fields: Record<string, unknown> = {};
    const rawFields = record.fields;
    for (const fieldId in rawFields) {
      if (!Object.prototype.hasOwnProperty.call(rawFields, fieldId)) continue;
      const value = rawFields[fieldId];
      if (value == null) continue;
      const formatterRes = resolveFormatter(fieldId);
      if (formatterRes.isErr()) return err(formatterRes.error);
      if (formatterRes.value) {
        const formattedValue = formatterRes.value(value);
        if (formattedValue.isErr()) return err(formattedValue.error);
        fields[fieldId] = formattedValue.value;
      }
    }
    presented[i] = name != null ? { ...record, name: String(name), fields } : { ...record, fields };
  }
  return ok(presented);
};
