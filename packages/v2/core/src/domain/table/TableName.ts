import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { ValueObject } from '../shared/ValueObject';

const tableNameSchema = z.string().trim().min(1);

export class TableName extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<TableName, DomainError> {
    const parsed = tableNameSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid TableName' }));
    return ok(new TableName(parsed.data));
  }

  equals(other: TableName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
