import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

export const fieldTypeValues = [
  'singleLineText',
  'longText',
  'number',
  'rating',
  'formula',
  'rollup',
  'lookup',
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
  'conditionalRollup',
  'conditionalLookup',
] as const;

const fieldTypeSchema = z.enum(fieldTypeValues);
type IFieldTypeLiteral = z.infer<typeof fieldTypeSchema>;

export class FieldType extends ValueObject {
  private constructor(private readonly value: IFieldTypeLiteral) {
    super();
  }

  static create(raw: unknown): Result<FieldType, DomainError> {
    const parsed = fieldTypeSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldType' }));
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

  static lookup(): FieldType {
    return new FieldType('lookup');
  }

  static conditionalRollup(): FieldType {
    return new FieldType('conditionalRollup');
  }

  static conditionalLookup(): FieldType {
    return new FieldType('conditionalLookup');
  }

  equals(other: FieldType): boolean {
    return this.value === other.value;
  }

  toString(): IFieldTypeLiteral {
    return this.value;
  }
}
