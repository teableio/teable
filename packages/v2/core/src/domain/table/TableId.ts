import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../shared/DomainError';
import { generatePrefixedId, prefixedIdRegex } from '../shared/IdGenerator';
import { ValueObject } from '../shared/ValueObject';

const tableIdPrefix = 'tbl';
const tableIdBodyLength = 16;
const tableIdSchema = z.string().regex(prefixedIdRegex(tableIdPrefix, tableIdBodyLength));

export class TableId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<TableId, DomainError> {
    const parsed = tableIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid TableId' }));
    return ok(new TableId(parsed.data));
  }

  static generate(): Result<TableId, DomainError> {
    try {
      return ok(new TableId(generatePrefixedId(tableIdPrefix, tableIdBodyLength)));
    } catch {
      return err(domainError.unexpected({ message: 'Failed to generate TableId' }));
    }
  }

  equals(other: TableId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
