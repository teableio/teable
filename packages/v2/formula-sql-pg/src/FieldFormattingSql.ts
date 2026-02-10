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

export const formatNumberStringSql = (valueSql: string, formatting: NumberFormatting): string => {
  const precision = formatting.precision().toNumber();
  const decimalPart = precision > 0 ? `D${'0'.repeat(precision)}` : '';
  const mask = `999999990${decimalPart}`;
  const maskSql = sqlStringLiteral(mask);
  const baseValue = `(${valueSql})::numeric`;

  switch (formatting.type()) {
    case NumberFormattingType.Percent: {
      const percentValue = `(${baseValue} * 100)`;
      const formatted = `trim(to_char(${percentValue}, ${maskSql}))`;
      return `${formatted} || ${sqlStringLiteral('%')}`;
    }
    case NumberFormattingType.Currency: {
      const formatted = `trim(to_char(${baseValue}, ${maskSql}))`;
      return `${sqlStringLiteral(formatting.symbol() ?? '')} || ${formatted}`;
    }
    case NumberFormattingType.Decimal:
    default:
      return `trim(to_char(${baseValue}, ${maskSql}))`;
  }
};

export const formatDatetimeStringSql = (
  valueSql: string,
  formatting: DateTimeFormatting,
  timeZoneOverride?: string
): string => {
  const dateMask = mapDateFormatMask(formatting.date());
  const timeMask = mapTimeFormatMask(formatting.time());
  const fullMask = timeMask ? `${dateMask} ${timeMask}` : dateMask;
  const maskSql = sqlStringLiteral(fullMask);
  const timeZone = timeZoneOverride ?? formatting.timeZone().toString();
  const tz = mapTimeZoneToPg(timeZone);
  const zonedValue = `(${valueSql})::timestamptz AT TIME ZONE ${sqlStringLiteral(tz)}`;
  return `TO_CHAR(${zonedValue}, ${maskSql})`;
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
  timeZoneOverride?: string
): string | undefined => {
  const formatting = resolveFormatting(field);
  if (!formatting) return undefined;

  if (formatting instanceof NumberFormatting) {
    if (valueType && valueType !== 'number') return undefined;
    return formatNumberStringSql(valueSql, formatting);
  }

  if (formatting instanceof DateTimeFormatting) {
    if (valueType && valueType !== 'datetime') return undefined;
    return formatDatetimeStringSql(valueSql, formatting, timeZoneOverride);
  }

  return undefined;
};
