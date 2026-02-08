import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';

const cellValueTypeSchema = z.enum(['string', 'number', 'boolean', 'dateTime']);
export type CellValueTypeValue = z.infer<typeof cellValueTypeSchema>;

export class CellValueType extends ValueObject {
  private constructor(private readonly value: CellValueTypeValue) {
    super();
  }

  static create(raw: unknown): Result<CellValueType, DomainError> {
    const parsed = cellValueTypeSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid CellValueType' }));
    return ok(new CellValueType(parsed.data));
  }

  static string(): CellValueType {
    return new CellValueType('string');
  }

  static number(): CellValueType {
    return new CellValueType('number');
  }

  static boolean(): CellValueType {
    return new CellValueType('boolean');
  }

  static dateTime(): CellValueType {
    return new CellValueType('dateTime');
  }

  equals(other: CellValueType): boolean {
    return this.value === other.value;
  }

  toString(): CellValueTypeValue {
    return this.value;
  }
}
