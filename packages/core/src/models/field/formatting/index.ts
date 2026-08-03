import { z } from '../../../zod';
import { CellValueType } from '../constant';
import {
  datetimeFormattingSchema,
  defaultDatetimeFormatting,
  type IDatetimeFormatting,
} from './datetime';
import { defaultNumberFormatting, numberFormattingSchema, type INumberFormatting } from './number';

export * from './number';
export * from './datetime';
export * from './time-zone';

export type IUnionFormatting = IDatetimeFormatting | INumberFormatting;

const translateNumberFormattingError = (issue: z.ZodIssue): string => {
  if (issue.code === 'invalid_union') {
    return 'Invalid "type" value. Must be one of: decimal, percent, currency';
  }
  if (issue.code === 'too_big' && issue.path[0] === 'precision') {
    return `Precision must be between 0 and ${issue.maximum}`;
  }
  if (issue.code === 'too_small' && issue.path[0] === 'precision') {
    return `Precision must be between ${issue.minimum} and 5`;
  }
  if (issue.code === 'invalid_type' && issue.path[0] === 'symbol') {
    return 'Currency formatting requires "symbol" field';
  }
  if (issue.code === 'unrecognized_keys') {
    return `Unrecognized fields: ${issue.keys?.join(', ')}`;
  }
  return `Invalid number formatting: ${issue.message}`;
};

const translateDatetimeFormattingError = (issue: z.ZodIssue): string => {
  if (issue.code === 'invalid_type' && issue.path[0] === 'date') {
    return 'Datetime formatting requires "date" field';
  }
  if (issue.code === 'invalid_type' && issue.path[0] === 'time') {
    return 'Datetime formatting requires "time" field';
  }
  if (issue.code === 'invalid_type' && issue.path[0] === 'timeZone') {
    return 'Datetime formatting requires "timeZone" field';
  }
  if (issue.code === 'invalid_value' && issue.path[0] === 'time') {
    return 'Invalid "time" value. Must be one of: HH:mm, hh:mm A, None';
  }
  return `Invalid datetime formatting: ${issue.message}`;
};

const createPreciseErrorMessage = (val: unknown): string | undefined => {
  if (typeof val !== 'object' || val === null) {
    return 'Formatting must be an object';
  }

  const hasNumberOnlyFields = 'precision' in val || 'symbol' in val;
  const hasTypeField = 'type' in val;
  const hasDatetimeFields = 'date' in val || 'time' in val || 'timeZone' in val;

  const isNumberFormatting = hasNumberOnlyFields || hasTypeField;
  const isDatetimeFormatting = hasDatetimeFields;

  if (isNumberFormatting && isDatetimeFormatting) {
    return 'Cannot mix number formatting (type, precision, symbol) with datetime formatting (date, time, timeZone)';
  }

  if (isNumberFormatting) {
    if (!hasTypeField) {
      return 'Number formatting requires "type" field (decimal, percent, or currency)';
    }

    const result = numberFormattingSchema.safeParse(val);
    if (!result.success) {
      return translateNumberFormattingError(result.error.issues[0]);
    }
    return undefined;
  }

  if (isDatetimeFormatting) {
    const result = datetimeFormattingSchema.safeParse(val);
    if (!result.success) {
      return translateDatetimeFormattingError(result.error.issues[0]);
    }
    return undefined;
  }

  return 'Invalid formatting. Expected number formatting (type, precision) or datetime formatting (date, time, timeZone)';
};

export const unionFormattingSchema = z
  .any()
  // eslint-disable-next-line sonarjs/cognitive-complexity
  .superRefine((val, ctx) => {
    const errorMessage = createPreciseErrorMessage(val);

    if (errorMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: errorMessage,
      });
    }
  })
  .meta({
    description:
      'Different cell value types are determined based on the results of expression parsing',
  });

export const getDefaultFormatting = (cellValueType: CellValueType) => {
  switch (cellValueType) {
    case CellValueType.Number:
      return defaultNumberFormatting;
    case CellValueType.DateTime:
      return defaultDatetimeFormatting;
  }
};

export const getFormattingSchema = (cellValueType: CellValueType) => {
  switch (cellValueType) {
    case CellValueType.Number:
      return numberFormattingSchema;
    case CellValueType.DateTime:
      return datetimeFormattingSchema;
    default:
      return z.undefined().meta({
        description: 'Only number and datetime cell value type support formatting',
      });
  }
};
