import {
  ConditionalLookupField,
  DateTimeFormatting,
  FieldType,
  LookupField,
  NumberFormatting,
  NumberFormattingType,
  TimeFormatting,
  type Field,
} from '@teable/v2-core';
import { sqlText, type FormulaCompileBudget } from './FormulaCompileBudget';

import { sqlStringLiteral } from './PgSqlHelpers';
import type { SqlValueType } from './SqlExpression';
import { mapTimeZoneToPg } from './TimeZonePgMapping';

const DEFAULT_DATE_MASK = 'YYYY-MM-DD';

const mapDateFormatMask = (format: string): string => {
  switch (format) {
    case 'M/D/YYYY':
      return 'FMMM/FMDD/YYYY';
    case 'D/M/YYYY':
      return 'FMDD/FMMM/YYYY';
    case 'YYYY/MM/DD':
      return 'YYYY/MM/DD';
    case 'YYYY-MM-DD':
      return DEFAULT_DATE_MASK;
    case 'YYYY-MM':
      return 'YYYY-MM';
    case 'MM-DD':
      return 'MM-DD';
    case 'YYYY':
      return 'YYYY';
    case 'MM':
      return 'MM';
    case 'DD':
      return 'DD';
    default:
      return DEFAULT_DATE_MASK;
  }
};

const mapTimeFormatMask = (format: TimeFormatting): string => {
  switch (format) {
    case TimeFormatting.Hour24:
      return 'HH24:MI';
    case TimeFormatting.Hour12:
      return 'HH12:MI AM';
    case TimeFormatting.None:
    default:
      return '';
  }
};

export const formatNumberStringSql = (
  valueSql: string,
  formatting: NumberFormatting,
  budget?: FormulaCompileBudget
): string => {
  const precision = formatting.precision().toNumber();
  const decimalPart = precision > 0 ? (budget?.sql ?? sqlText)`D${'0'.repeat(precision)}` : '';
  const mask = (budget?.sql ?? sqlText)`999999990${decimalPart}`;
  const maskSql = sqlStringLiteral(mask, budget);
  const baseValue = (budget?.sql ?? sqlText)`(${valueSql})::numeric`;

  return formatNumberStringSqlWithBaseValue(baseValue, formatting, maskSql, budget);
};

const buildJsonScalarNumericSql = (valueSql: string, budget?: FormulaCompileBudget): string => {
  const jsonValue = (budget?.sql ?? sqlText)`to_jsonb(${valueSql})`;
  return (budget?.sql ?? sqlText)`(CASE
    WHEN ${valueSql} IS NULL THEN NULL
    WHEN jsonb_typeof(${jsonValue}) = 'array' THEN NULLIF((${jsonValue} ->> 0), '')::numeric
    WHEN jsonb_typeof(${jsonValue}) = 'null' THEN NULL
    ELSE NULLIF((${jsonValue} #>> '{}'), '')::numeric
  END)`;
};

const formatNumberStringSqlWithBaseValue = (
  baseValue: string,
  formatting: NumberFormatting,
  maskSql: string,
  budget?: FormulaCompileBudget
): string => {
  switch (formatting.type()) {
    case NumberFormattingType.Percent: {
      const percentValue = (budget?.sql ?? sqlText)`(${baseValue} * 100)`;
      const formatted = (budget?.sql ?? sqlText)`trim(to_char(${percentValue}, ${maskSql}))`;
      return (budget?.sql ?? sqlText)`${formatted} || ${sqlStringLiteral('%', budget)}`;
    }
    case NumberFormattingType.Currency: {
      const formatted = (budget?.sql ?? sqlText)`trim(to_char(${baseValue}, ${maskSql}))`;
      return (budget?.sql ??
        sqlText)`${sqlStringLiteral(formatting.symbol() ?? '', budget)} || ${formatted}`;
    }
    case NumberFormattingType.Decimal:
    default:
      return (budget?.sql ?? sqlText)`trim(to_char(${baseValue}, ${maskSql}))`;
  }
};

type NumberFormatOptions = {
  normalizeJsonScalar?: boolean;
};

export const formatDatetimeStringSql = (
  valueSql: string,
  formatting: DateTimeFormatting,
  timeZoneOverride?: string,
  budget?: FormulaCompileBudget
): string => {
  const dateMask = mapDateFormatMask(formatting.date());
  const timeMask = mapTimeFormatMask(formatting.time());
  const fullMask = timeMask ? (budget?.sql ?? sqlText)`${dateMask} ${timeMask}` : dateMask;
  const maskSql = sqlStringLiteral(fullMask, budget);
  const timeZone = timeZoneOverride ?? formatting.timeZone().toString();
  const tz = mapTimeZoneToPg(timeZone);
  const zonedValue = (budget?.sql ??
    sqlText)`(${valueSql})::timestamptz AT TIME ZONE ${sqlStringLiteral(tz, budget)}`;
  return (budget?.sql ?? sqlText)`TO_CHAR(${zonedValue}, ${maskSql})`;
};

const resolveLookupInnerField = (field: Field): Field | null => {
  if (field.type().equals(FieldType.lookup())) {
    const lookupField = field as LookupField;
    const innerFieldResult = lookupField.innerField();
    return innerFieldResult.isOk() ? innerFieldResult.value : null;
  }
  if (field.type().equals(FieldType.conditionalLookup())) {
    const lookupField = field as ConditionalLookupField;
    const innerFieldResult = lookupField.innerField();
    return innerFieldResult.isOk() ? innerFieldResult.value : null;
  }
  return null;
};

const resolveFormatting = (
  field: Field | undefined
): NumberFormatting | DateTimeFormatting | undefined => {
  if (!field) return undefined;
  const formatting = (field as { formatting?: () => unknown }).formatting?.();
  if (formatting instanceof NumberFormatting || formatting instanceof DateTimeFormatting) {
    return formatting;
  }
  const innerField = resolveLookupInnerField(field);
  if (!innerField) return undefined;
  const innerFormatting = (innerField as { formatting?: () => unknown }).formatting?.();
  if (
    innerFormatting instanceof NumberFormatting ||
    innerFormatting instanceof DateTimeFormatting
  ) {
    return innerFormatting;
  }
  return undefined;
};

export const formatFieldValueAsStringSql = (
  field: Field | undefined,
  valueSql: string,
  valueType?: SqlValueType,
  timeZoneOverride?: string,
  options?: NumberFormatOptions,
  budget?: FormulaCompileBudget
): string | undefined => {
  const sql = budget?.sql ?? sqlText;
  const formatting = resolveFormatting(field);
  if (!formatting) return undefined;

  if (formatting instanceof NumberFormatting) {
    if (valueType && valueType !== 'number') return undefined;
    if (options?.normalizeJsonScalar) {
      const precision = formatting.precision().toNumber();
      const decimalPart = precision > 0 ? sql`D${'0'.repeat(precision)}` : '';
      const mask = sql`999999990${decimalPart}`;
      const maskSql = sqlStringLiteral(mask, budget);
      return formatNumberStringSqlWithBaseValue(
        buildJsonScalarNumericSql(valueSql, budget),
        formatting,
        maskSql,
        budget
      );
    }
    return formatNumberStringSql(valueSql, formatting, budget);
  }

  if (formatting instanceof DateTimeFormatting) {
    if (valueType && valueType !== 'datetime') return undefined;
    return formatDatetimeStringSql(valueSql, formatting, timeZoneOverride, budget);
  }

  return undefined;
};
