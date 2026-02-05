import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { NumericPrecision } from './NumericPrecision';

export const NumberFormattingType = {
  Decimal: 'decimal',
  Percent: 'percent',
  Currency: 'currency',
} as const;

export type NumberFormattingType = (typeof NumberFormattingType)[keyof typeof NumberFormattingType];

const baseFormattingSchema = z.object({
  precision: z.number().min(0).max(5),
});

const decimalFormattingSchema = baseFormattingSchema.extend({
  type: z.literal(NumberFormattingType.Decimal),
});

const percentFormattingSchema = baseFormattingSchema.extend({
  type: z.literal(NumberFormattingType.Percent),
});

const currencyFormattingSchema = baseFormattingSchema.extend({
  type: z.literal(NumberFormattingType.Currency),
  symbol: z.string(),
});

const numberFormattingSchema = z.discriminatedUnion('type', [
  decimalFormattingSchema,
  percentFormattingSchema,
  currencyFormattingSchema,
]);

export type NumberFormattingValue = z.infer<typeof numberFormattingSchema>;

export class NumberFormatting extends ValueObject {
  private constructor(
    private readonly typeValue: NumberFormattingType,
    private readonly precisionValue: NumericPrecision,
    private readonly symbolValue?: string
  ) {
    super();
  }

  static create(raw: unknown): Result<NumberFormatting, DomainError> {
    const parsed = numberFormattingSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid NumberFormatting' }));

    return NumericPrecision.create(parsed.data.precision).map((precision) => {
      if (parsed.data.type === NumberFormattingType.Currency) {
        return new NumberFormatting(parsed.data.type, precision, parsed.data.symbol);
      }
      return new NumberFormatting(parsed.data.type, precision);
    });
  }

  static default(): NumberFormatting {
    return new NumberFormatting(NumberFormattingType.Decimal, NumericPrecision.default());
  }

  equals(other: NumberFormatting): boolean {
    return (
      this.typeValue === other.typeValue &&
      this.precisionValue.equals(other.precisionValue) &&
      this.symbolValue === other.symbolValue
    );
  }

  type(): NumberFormattingType {
    return this.typeValue;
  }

  precision(): NumericPrecision {
    return this.precisionValue;
  }

  symbol(): string | undefined {
    return this.symbolValue;
  }

  toDto(): NumberFormattingValue {
    const precision = this.precisionValue.toNumber();
    if (this.typeValue === NumberFormattingType.Currency) {
      return { type: this.typeValue, precision, symbol: this.symbolValue ?? '' };
    }
    return { type: this.typeValue, precision };
  }
}
