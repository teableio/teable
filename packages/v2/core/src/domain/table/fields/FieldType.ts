import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { ValueObject } from '../../shared/ValueObject';

const fieldTypeSchema = z.enum([
  'singleLineText',
  'longText',
  'number',
  'rating',
  'formula',
  'rollup',
  'singleSelect',
  'multipleSelect',
  'checkbox',
  'attachment',
  'date',
  'createdTime',
  'lastModifiedTime',
  'user',
  'createdBy',
  'lastModifiedBy',
  'autoNumber',
  'button',
  'link',
]);
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

  static longText(): FieldType {
    return new FieldType('longText');
  }

  static number(): FieldType {
    return new FieldType('number');
  }

  static rating(): FieldType {
    return new FieldType('rating');
  }

  static formula(): FieldType {
    return new FieldType('formula');
  }

  static rollup(): FieldType {
    return new FieldType('rollup');
  }

  static singleSelect(): FieldType {
    return new FieldType('singleSelect');
  }

  static multipleSelect(): FieldType {
    return new FieldType('multipleSelect');
  }

  static checkbox(): FieldType {
    return new FieldType('checkbox');
  }

  static attachment(): FieldType {
    return new FieldType('attachment');
  }

  static date(): FieldType {
    return new FieldType('date');
  }

  static createdTime(): FieldType {
    return new FieldType('createdTime');
  }

  static lastModifiedTime(): FieldType {
    return new FieldType('lastModifiedTime');
  }

  static user(): FieldType {
    return new FieldType('user');
  }

  static createdBy(): FieldType {
    return new FieldType('createdBy');
  }

  static lastModifiedBy(): FieldType {
    return new FieldType('lastModifiedBy');
  }

  static autoNumber(): FieldType {
    return new FieldType('autoNumber');
  }

  static button(): FieldType {
    return new FieldType('button');
  }

  static link(): FieldType {
    return new FieldType('link');
  }

  equals(other: FieldType): boolean {
    return this.value === other.value;
  }

  toString(): IFieldTypeLiteral {
    return this.value;
  }
}
