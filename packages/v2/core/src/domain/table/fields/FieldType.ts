import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../shared/ValueObject';

const fieldTypeSchema = z.enum(['singleLineText', 'number', 'rating', 'singleSelect']);
type IFieldTypeLiteral = z.infer<typeof fieldTypeSchema>;

export class FieldType extends ValueObject {
  private constructor(private readonly value: IFieldTypeLiteral) {
    super();
  }

  static create(raw: unknown): Result<FieldType, string> {
    const parsed = fieldTypeSchema.safeParse(raw);
    if (!parsed.success) return err('Invalid FieldType');
    return ok(new FieldType(parsed.data));
  }

  static singleLineText(): FieldType {
    return new FieldType('singleLineText');
  }

  static number(): FieldType {
    return new FieldType('number');
  }

  static rating(): FieldType {
    return new FieldType('rating');
  }

  static singleSelect(): FieldType {
    return new FieldType('singleSelect');
  }

  equals(other: FieldType): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
