import { z } from 'zod';

import { TimeFormatting } from '../../domain/table/fields/types/DateTimeFormatting';
import { fieldColorSchema } from '../../domain/table/fields/types/FieldColor';
import { NumberFormattingType } from '../../domain/table/fields/types/NumberFormatting';
import {
  MultiNumberDisplayType,
  SingleNumberDisplayType,
} from '../../domain/table/fields/types/NumberShowAs';
import { ratingColorValues } from '../../domain/table/fields/types/RatingColor';
import { ratingIconValues } from '../../domain/table/fields/types/RatingIcon';
import { singleLineTextShowAsValues } from '../../domain/table/fields/types/SingleLineTextShowAs';
import { TIME_ZONE_LIST } from '../../domain/table/fields/types/TimeZone';

// Basic enum schemas (re-export or define locally)
export const ratingIconSchema = z.enum(ratingIconValues);
export const ratingColorSchema = z.enum(ratingColorValues);

// ShowAs schemas
export const singleLineTextShowAsSchema = z.object({
  type: z.enum(singleLineTextShowAsValues),
});

// Number formatting
export const numberFormattingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(NumberFormattingType.Decimal),
    precision: z.number().min(0).max(5),
  }),
  z.object({
    type: z.literal(NumberFormattingType.Percent),
    precision: z.number().min(0).max(5),
  }),
  z.object({
    type: z.literal(NumberFormattingType.Currency),
    precision: z.number().min(0).max(5),
    symbol: z.string(),
  }),
]);

export const singleNumberShowAsSchema = z.object({
  type: z.enum([SingleNumberDisplayType.Bar, SingleNumberDisplayType.Ring]),
  color: fieldColorSchema,
  showValue: z.boolean(),
  maxValue: z.number(),
});

export const multiNumberShowAsSchema = z.object({
  type: z.enum([MultiNumberDisplayType.Bar, MultiNumberDisplayType.Line]),
  color: fieldColorSchema,
});

export const numberShowAsSchema = z.union([singleNumberShowAsSchema, multiNumberShowAsSchema]);

// Date formatting
export const dateFormattingSchema = z.object({
  date: z.string(),
  time: z.enum([TimeFormatting.Hour24, TimeFormatting.Hour12, TimeFormatting.None]),
  timeZone: z.enum(TIME_ZONE_LIST),
});

// Formula formatting (union of number and date)
export const formulaFormattingSchema = z.union([numberFormattingSchema, dateFormattingSchema]);

// Formula showAs
export const formulaShowAsSchema = z.union([singleLineTextShowAsSchema, numberShowAsSchema]);

// Cell value type
export const cellValueTypeSchema = z.enum(['string', 'number', 'boolean', 'dateTime']);

// Filter schemas
export const filterItemSchema = z.object({
  fieldId: z.string(),
  operator: z.string(),
  value: z.unknown(),
  isSymbol: z.boolean().optional(),
});

export const filterSetSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    filterItemSchema,
    z.object({
      conjunction: z.enum(['and', 'or']),
      filterSet: z.array(filterSetSchema),
    }),
  ])
);

export const fieldConditionSchema = z.object({
  filter: z
    .object({
      conjunction: z.enum(['and', 'or']),
      filterSet: z.array(filterSetSchema).optional(),
    })
    .nullable()
    .optional(),
  sort: z
    .object({
      fieldId: z.string(),
      order: z.enum(['asc', 'desc']),
    })
    .optional(),
  limit: z.number().optional(),
});

// Tracked field IDs
export const trackedFieldIdsSchema = z.array(z.string());

// Link relationship
export const linkRelationshipSchema = z.enum(['oneOne', 'manyMany', 'oneMany', 'manyOne']);
