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
  private static readonly primarySupportedTypes = new Set<IFieldTypeLiteral>([
    'singleLineText',
    'longText',
    'user',
    'multipleSelect',
    'singleSelect',
    'date',
    'number',
    'rating',
    'formula',
    'createdTime',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'autoNumber',
  ]);

  private constructor(private readonly value: IFieldTypeLiteral) {
    super();
  }

  // FieldType is immutable and compared by value, so hot paths share one
  // instance per literal instead of allocating on every static accessor call.
  private static readonly interned = new Map<IFieldTypeLiteral, FieldType>();

  private static of(value: IFieldTypeLiteral): FieldType {
    let instance = FieldType.interned.get(value);
    if (!instance) {
      instance = new FieldType(value);
      FieldType.interned.set(value, instance);
    }
    return instance;
  }

  static create(raw: unknown): Result<FieldType, DomainError> {
    const parsed = fieldTypeSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid FieldType' }));
    return ok(FieldType.of(parsed.data));
  }

  static singleLineText(): FieldType {
    return FieldType.of('singleLineText');
  }

  static longText(): FieldType {
    return FieldType.of('longText');
  }

  static number(): FieldType {
    return FieldType.of('number');
  }

  static rating(): FieldType {
    return FieldType.of('rating');
  }

  static formula(): FieldType {
    return FieldType.of('formula');
  }

  static rollup(): FieldType {
    return FieldType.of('rollup');
  }

  static singleSelect(): FieldType {
    return FieldType.of('singleSelect');
  }

  static multipleSelect(): FieldType {
    return FieldType.of('multipleSelect');
  }

  static checkbox(): FieldType {
    return FieldType.of('checkbox');
  }

  static attachment(): FieldType {
    return FieldType.of('attachment');
  }

  static date(): FieldType {
    return FieldType.of('date');
  }

  static createdTime(): FieldType {
    return FieldType.of('createdTime');
  }

  static lastModifiedTime(): FieldType {
    return FieldType.of('lastModifiedTime');
  }

  static user(): FieldType {
    return FieldType.of('user');
  }

  static createdBy(): FieldType {
    return FieldType.of('createdBy');
  }

  static lastModifiedBy(): FieldType {
    return FieldType.of('lastModifiedBy');
  }

  static autoNumber(): FieldType {
    return FieldType.of('autoNumber');
  }

  static button(): FieldType {
    return FieldType.of('button');
  }

  static link(): FieldType {
    return FieldType.of('link');
  }

  static lookup(): FieldType {
    return FieldType.of('lookup');
  }

  static conditionalRollup(): FieldType {
    return FieldType.of('conditionalRollup');
  }

  static conditionalLookup(): FieldType {
    return FieldType.of('conditionalLookup');
  }

  equals(other: FieldType): boolean {
    return this.value === other.value;
  }

  toString(): IFieldTypeLiteral {
    return this.value;
  }

  isPrimarySupported(): boolean {
    return FieldType.primarySupportedTypes.has(this.value);
  }
}
