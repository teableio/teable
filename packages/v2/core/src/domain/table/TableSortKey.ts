import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';

export const tableSortKeyValues = ['name', 'id', 'createdTime'] as const;
export const tableSortKeySchema = z.enum(tableSortKeyValues);
export type TableSortKeyValue = z.infer<typeof tableSortKeySchema>;

export class TableSortKey extends ValueObject {
  private constructor(private readonly value: TableSortKeyValue) {
    super();
  }

  static create(raw: unknown): Result<TableSortKey, DomainError> {
    const parsed = tableSortKeySchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid TableSortKey' }));
    return ok(new TableSortKey(parsed.data));
  }

  static from(value: TableSortKeyValue): TableSortKey {
    return new TableSortKey(value);
  }

  static name(): TableSortKey {
    return new TableSortKey('name');
  }

  static id(): TableSortKey {
    return new TableSortKey('id');
  }

  static createdTime(): TableSortKey {
    return new TableSortKey('createdTime');
  }

  static default(): TableSortKey {
    return TableSortKey.createdTime();
  }

  equals(other: TableSortKey): boolean {
    return this.value === other.value;
  }

  toString(): TableSortKeyValue {
    return this.value;
  }
}
