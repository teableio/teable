import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../shared/DomainError';
import { generatePrefixedId, prefixedIdRegex } from '../shared/IdGenerator';
import { ValueObject } from '../shared/ValueObject';

const tableIdPrefix = 'tbl';
const tableIdBodyLength = 16;
const tableIdPattern = prefixedIdRegex(tableIdPrefix, tableIdBodyLength);

export class TableId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<TableId, DomainError> {
    if (typeof raw !== 'string' || !tableIdPattern.test(raw)) {
      return err(domainError.validation({ message: 'Invalid TableId' }));
    }
    return ok(new TableId(raw));
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
