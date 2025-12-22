import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../../shared/ValueObject';

const cellValueTypeSchema = z.enum(['string', 'number', 'boolean', 'dateTime']);
export type CellValueTypeValue = z.infer<typeof cellValueTypeSchema>;

export class CellValueType extends ValueObject {
  private constructor(private readonly value: CellValueTypeValue) {
    super();
  }

  static create(raw: unknown): Result<CellValueType, string> {
    const parsed = cellValueTypeSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid CellValueType');
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
