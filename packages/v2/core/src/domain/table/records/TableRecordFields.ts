import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';
import type { FieldId } from '../fields/FieldId';

const tableRecordCellValueSchema = z.unknown();

export class TableRecordCellValue extends ValueObject {
  private constructor(private readonly rawValue: unknown) {
    super();
  }

  static create(raw: unknown): Result<TableRecordCellValue, DomainError> {
    const parsed = tableRecordCellValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid TableRecordCellValue' }));
    return ok(new TableRecordCellValue(parsed.data));
  }

  equals(other: TableRecordCellValue): boolean {
    return Object.is(this.rawValue, other.rawValue);
  }

  toValue(): unknown {
    return this.rawValue;
  }
}

export type TableRecordFieldValue = {
  fieldId: FieldId;
  value: TableRecordCellValue;
};

export class TableRecordFields extends ValueObject {
  private constructor(private readonly entriesValue: ReadonlyArray<TableRecordFieldValue>) {
    super();
  }

  static create(
    entries: ReadonlyArray<TableRecordFieldValue>
  ): Result<TableRecordFields, DomainError> {
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = entry.fieldId.toString();
      if (seen.has(key))
        return err(domainError.conflict({ message: 'Duplicate TableRecord field id' }));
      seen.add(key);
    }
    return ok(new TableRecordFields([...entries]));
  }

  entries(): ReadonlyArray<TableRecordFieldValue> {
    return [...this.entriesValue];
  }

  get(fieldId: FieldId): TableRecordCellValue | undefined {
    return this.entriesValue.find((entry) => entry.fieldId.equals(fieldId))?.value;
  }

  /**
   * Set a field value, returning a new TableRecordFields instance.
   * If the fieldId already exists, the value is updated.
   * If the fieldId doesn't exist, a new entry is added.
   */
  set(fieldId: FieldId, value: TableRecordCellValue): Result<TableRecordFields, DomainError> {
    const existingIndex = this.entriesValue.findIndex((entry) => entry.fieldId.equals(fieldId));
    const newEntries = [...this.entriesValue];

    if (existingIndex >= 0) {
      // Update existing entry
      newEntries[existingIndex] = { fieldId, value };
    } else {
      // Add new entry
      newEntries.push({ fieldId, value });
    }

    return ok(new TableRecordFields(newEntries));
  }

  equals(other: TableRecordFields): boolean {
    if (this.entriesValue.length !== other.entriesValue.length) return false;
    const byId = new Map<string, TableRecordCellValue>();
    for (const entry of this.entriesValue) {
      byId.set(entry.fieldId.toString(), entry.value);
    }
    for (const entry of other.entriesValue) {
      const key = entry.fieldId.toString();
      if (!byId.has(key)) return false;
      const current = byId.get(key);
      if (!current || !current.equals(entry.value)) return false;
    }
    return true;
  }
}
