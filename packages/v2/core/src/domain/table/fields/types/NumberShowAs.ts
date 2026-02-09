import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { fieldColorSchema } from './FieldColor';

export const SingleNumberDisplayType = {
  Bar: 'bar',
  Ring: 'ring',
} as const;

export type SingleNumberDisplayType =
  (typeof SingleNumberDisplayType)[keyof typeof SingleNumberDisplayType];

export const MultiNumberDisplayType = {
  Bar: 'bar',
  Line: 'line',
} as const;

export type MultiNumberDisplayType =
  (typeof MultiNumberDisplayType)[keyof typeof MultiNumberDisplayType];

const singleNumberShowAsSchema = z.object({
  type: z.enum([SingleNumberDisplayType.Bar, SingleNumberDisplayType.Ring]),
  color: fieldColorSchema,
  showValue: z.boolean(),
  maxValue: z.number(),
});

const multiNumberShowAsSchema = z.object({
  type: z.enum([MultiNumberDisplayType.Bar, MultiNumberDisplayType.Line]),
  color: fieldColorSchema,
});

const numberShowAsSchema = z.union([singleNumberShowAsSchema, multiNumberShowAsSchema]);

export type NumberShowAsValue = z.infer<typeof numberShowAsSchema>;

export class NumberShowAs extends ValueObject {
  private constructor(private readonly value: NumberShowAsValue) {
    super();
  }

  static create(raw: unknown): Result<NumberShowAs, DomainError> {
    const parsed = numberShowAsSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid NumberShowAs' }));
    return ok(new NumberShowAs(parsed.data));
  }

  equals(other: NumberShowAs): boolean {
    const left = this.value;
    const right = other.value;
    if (left.type !== right.type) return false;
    if (left.color !== right.color) return false;
    const leftHasValue = 'showValue' in left;
    const rightHasValue = 'showValue' in right;
    if (leftHasValue !== rightHasValue) return false;
    if (leftHasValue && rightHasValue) {
      return left.showValue === right.showValue && left.maxValue === right.maxValue;
    }
    return true;
  }

  toDto(): NumberShowAsValue {
    return { ...this.value };
  }
}
