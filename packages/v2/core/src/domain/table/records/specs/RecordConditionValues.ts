import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import type { Field } from '../../fields/Field';
import { TimeZone } from '../../fields/types/TimeZone';
import {
  recordConditionDateModeSchema,
  type RecordConditionDateMode,
} from './RecordConditionOperators';

const literalValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const literalValueListSchema = literalValueSchema.array().nonempty();

const dateValueSchema = z
  .object({
    mode: recordConditionDateModeSchema,
    numberOfDays: z.coerce.number().int().nonnegative().optional(),
    exactDate: z.string().datetime({ precision: 3, offset: true }).optional(),
    timeZone: z.string(),
  })
  .superRefine((val, ctx) => {
    const requiresExact = val.mode === 'exactDate' || val.mode === 'exactFormatDate';
    const requiresDays =
      val.mode === 'daysAgo' ||
      val.mode === 'daysFromNow' ||
      val.mode === 'pastNumberOfDays' ||
      val.mode === 'nextNumberOfDays';

    if (requiresExact && !val.exactDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `When mode is '${val.mode}', exactDate is required`,
      });
    }

    if (requiresDays && val.numberOfDays == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `When mode is '${val.mode}', numberOfDays is required`,
      });
    }
  });

type LiteralValue = z.infer<typeof literalValueSchema>;

type DateValue = z.infer<typeof dateValueSchema>;

export class RecordConditionLiteralValue extends ValueObject {
  private constructor(private readonly value: LiteralValue) {
    super();
  }

  static create(raw: unknown): Result<RecordConditionLiteralValue, DomainError> {
    const parsed = literalValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RecordConditionLiteralValue' }));
    return ok(new RecordConditionLiteralValue(parsed.data));
  }

  equals(other: RecordConditionLiteralValue): boolean {
    return Object.is(this.value, other.value);
  }

  toValue(): LiteralValue {
    return this.value;
  }
}

export class RecordConditionLiteralListValue extends ValueObject {
  private constructor(private readonly values: ReadonlyArray<LiteralValue>) {
    super();
  }

  static create(raw: unknown): Result<RecordConditionLiteralListValue, DomainError> {
    const parsed = literalValueListSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RecordConditionLiteralListValue' }));
    return ok(new RecordConditionLiteralListValue(parsed.data));
  }

  equals(other: RecordConditionLiteralListValue): boolean {
    if (this.values.length !== other.values.length) return false;
    return this.values.every((value, index) => Object.is(value, other.values[index]));
  }

  toValues(): ReadonlyArray<LiteralValue> {
    return [...this.values];
  }
}

export class RecordConditionDateValue extends ValueObject {
  private constructor(
    private readonly modeValue: RecordConditionDateMode,
    private readonly numberOfDaysValue: number | undefined,
    private readonly exactDateValue: string | undefined,
    private readonly timeZoneValue: TimeZone
  ) {
    super();
  }

  static create(raw: unknown): Result<RecordConditionDateValue, DomainError> {
    const parsed = dateValueSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid RecordConditionDateValue' }));

    const timeZoneResult = TimeZone.create(parsed.data.timeZone);
    if (timeZoneResult.isErr()) return err(timeZoneResult.error);

    return ok(
      new RecordConditionDateValue(
        parsed.data.mode,
        parsed.data.numberOfDays,
        parsed.data.exactDate,
        timeZoneResult.value
      )
    );
  }

  equals(other: RecordConditionDateValue): boolean {
    return (
      this.modeValue === other.modeValue &&
      this.numberOfDaysValue === other.numberOfDaysValue &&
      this.exactDateValue === other.exactDateValue &&
      this.timeZoneValue.equals(other.timeZoneValue)
    );
  }

  mode(): RecordConditionDateMode {
    return this.modeValue;
  }

  numberOfDays(): number | undefined {
    return this.numberOfDaysValue;
  }

  exactDate(): string | undefined {
    return this.exactDateValue;
  }

  timeZone(): TimeZone {
    return this.timeZoneValue;
  }

  toConfig(): DateValue {
    return {
      mode: this.modeValue,
      numberOfDays: this.numberOfDaysValue,
      exactDate: this.exactDateValue,
      timeZone: this.timeZoneValue.toString(),
    };
  }
}

export class RecordConditionFieldReferenceValue extends ValueObject {
  private constructor(private readonly fieldValue: Field) {
    super();
  }

  static create(field: Field): Result<RecordConditionFieldReferenceValue, DomainError> {
    return ok(new RecordConditionFieldReferenceValue(field));
  }

  equals(other: RecordConditionFieldReferenceValue): boolean {
    return this.fieldValue.id().equals(other.fieldValue.id());
  }

  field(): Field {
    return this.fieldValue;
  }
}

export type RecordConditionValue =
  | RecordConditionLiteralValue
  | RecordConditionLiteralListValue
  | RecordConditionDateValue
  | RecordConditionFieldReferenceValue;

export const isRecordConditionLiteralValue = (
  value: RecordConditionValue | undefined
): value is RecordConditionLiteralValue => value instanceof RecordConditionLiteralValue;

export const isRecordConditionLiteralListValue = (
  value: RecordConditionValue | undefined
): value is RecordConditionLiteralListValue => value instanceof RecordConditionLiteralListValue;

export const isRecordConditionDateValue = (
  value: RecordConditionValue | undefined
): value is RecordConditionDateValue => value instanceof RecordConditionDateValue;

export const isRecordConditionFieldReferenceValue = (
  value: RecordConditionValue | undefined
): value is RecordConditionFieldReferenceValue =>
  value instanceof RecordConditionFieldReferenceValue;
