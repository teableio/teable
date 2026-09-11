import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../shared/DomainError';
import { generatePrefixedId } from '../../shared/IdGenerator';
import { ValueObject } from '../../shared/ValueObject';

const fieldIdPrefix = 'fld';
const fieldIdBodyLength = 16;
const legacyFieldIdMaxBodyLength = 64;
const fieldIdPattern = new RegExp(
  `^${fieldIdPrefix}[0-9a-zA-Z]{1,${legacyFieldIdMaxBodyLength}}(?:_\\d+)?$`
);

export class FieldId extends ValueObject {
  private constructor(private readonly value: string) {
    super();
  }

  static create(raw: unknown): Result<FieldId, DomainError> {
    if (typeof raw !== 'string' || !fieldIdPattern.test(raw)) {
      return err(domainError.validation({ message: 'Invalid FieldId' }));
    }
    return ok(new FieldId(raw));
  }

  static generate(): Result<FieldId, DomainError> {
    try {
      return ok(new FieldId(generatePrefixedId(fieldIdPrefix, fieldIdBodyLength)));
    } catch {
      return err(domainError.unexpected({ message: 'Failed to generate FieldId' }));
    }
  }

  static mustGenerate(): FieldId {
    const result = FieldId.generate();
    if (result.isOk()) return result.value;
    const fallbackBody = Math.random()
      .toString(36)
      .slice(2)
      .padEnd(fieldIdBodyLength, '0')
      .slice(0, fieldIdBodyLength);
    return new FieldId(`${fieldIdPrefix}${fallbackBody}`);
  }

  equals(other: FieldId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
