import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId, prefixedIdRegex } from '../../shared/IdGenerator';
import { ValueObject } from '../../shared/ValueObject';

const recordIdPrefix = 'rec';
const recordIdBodyLength = 16;
// Parsing is looser than generation: v1 only enforced the `rec` prefix, so
// imported/legacy records may carry other body lengths (same bound as FieldId).
const legacyRecordIdMaxBodyLength = 64;
const recordIdPattern = new RegExp(
  `^${recordIdPrefix}[0-9a-zA-Z]{1,${legacyRecordIdMaxBodyLength}}$`
);
const recordIdSchema = z.string().regex(recordIdPattern);
const canonicalRecordIdPattern = prefixedIdRegex(recordIdPrefix, recordIdBodyLength);

export class RecordId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<RecordId, DomainError> {
    const parsed = recordIdSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid RecordId' }));
    return ok(new RecordId(parsed.data));
  }

  /**
   * Strict generated-format check (`rec` + 16 alphanumeric chars). Use for
   * heuristics that must not mistake user text like "recipe" for a record id;
   * `create` stays tolerant of legacy variable-length ids.
   */
  static isCanonical(raw: unknown): boolean {
    return typeof raw === 'string' && canonicalRecordIdPattern.test(raw);
  }

  static generate(): Result<RecordId, DomainError> {
    try {
      return ok(new RecordId(generatePrefixedId(recordIdPrefix, recordIdBodyLength)));
    } catch {
      return err(domainError.unexpected({ message: 'Failed to generate RecordId' }));
    }
  }

  equals(other: RecordId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
