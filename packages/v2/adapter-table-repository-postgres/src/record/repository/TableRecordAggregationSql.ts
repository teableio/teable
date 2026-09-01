import {
  FieldValueTypeVisitor,
  type Field,
  type TableRecordAggregationFunction,
} from '@teable/v2-core';
import { sql, type RawBuilder } from 'kysely';

const percentFunctions: ReadonlyArray<TableRecordAggregationFunction> = [
  'percentEmpty',
  'percentFilled',
  'percentUnique',
  'percentChecked',
  'percentUnChecked',
];

const flattenedFunctions: ReadonlyArray<TableRecordAggregationFunction> = [
  'unique',
  'max',
  'min',
  'sum',
  'average',
  'percentUnique',
  'earliestDate',
  'latestDate',
  'dateRangeOfDays',
  'dateRangeOfMonths',
];

export const buildTableRecordAggregationExpression = (
  field: Field,
  columnName: string,
  statisticFunc: TableRecordAggregationFunction
): RawBuilder<unknown> => {
  const column = sql.ref(`a.${columnName}`);
  const fieldType = field.type().toString();
  const valueType = field.accept(new FieldValueTypeVisitor())._unsafeUnwrap();
  const isMultiple = valueType.isMultipleCellValue.toBoolean();
  const isUserLike = ['user', 'createdBy', 'lastModifiedBy'].includes(fieldType);
  const flattenedValues = sql`jsonb_array_elements_text(
    jsonb_path_query_array(
      coalesce(jsonb_agg(${column}::jsonb) filter (where ${column} is not null), '[]'::jsonb),
      '$[*][*]'
    )
  ) as flattened(value)`;
  const numericValue = sql`nullif(regexp_replace(value, '[^0-9.+-]', '', 'g'), '')::double precision`;
  const denominator = sql`greatest(count(*), 1)`;

  if (isMultiple && flattenedFunctions.includes(statisticFunc)) {
    switch (statisticFunc) {
      case 'unique':
        return sql`(select count(distinct value) from ${flattenedValues})`;
      case 'max':
        return sql`(select max(${numericValue}) from ${flattenedValues})`;
      case 'min':
        return sql`(select min(${numericValue}) from ${flattenedValues})`;
      case 'sum':
        return sql`(select sum(${numericValue}) from ${flattenedValues})`;
      case 'average':
        return sql`(select avg(${numericValue}) from ${flattenedValues})`;
      case 'percentUnique':
        return sql`(select count(distinct value) * 100.0 / greatest(count(*), 1) from ${flattenedValues})`;
      case 'earliestDate':
        return sql`(select min(value::timestamptz) from ${flattenedValues})`;
      case 'latestDate':
        return sql`(select max(value::timestamptz) from ${flattenedValues})`;
      case 'dateRangeOfDays':
        return sql`(select extract(day from (max(value::timestamptz) - min(value::timestamptz)))::integer from ${flattenedValues})`;
      case 'dateRangeOfMonths':
        return sql`(select (
          extract(year from age(max(value::timestamptz), min(value::timestamptz))) * 12 +
          extract(month from age(max(value::timestamptz), min(value::timestamptz)))
        )::integer from ${flattenedValues})`;
    }
  }

  switch (statisticFunc) {
    case 'count':
      return sql`count(*)`;
    case 'empty':
      return sql`count(*) - count(${column})`;
    case 'filled':
      return sql`count(${column})`;
    case 'unique':
      return isUserLike
        ? sql`count(distinct (${column}::jsonb ->> 'id'))`
        : sql`count(distinct ${column})`;
    case 'max':
      return sql`max(${column})`;
    case 'min':
      return sql`min(${column})`;
    case 'sum':
      return sql`sum(${column})`;
    case 'average':
      return sql`avg(${column})`;
    case 'checked':
      return isMultiple
        ? sql`sum(case when ${column}::jsonb @> '[true]'::jsonb then 1 else 0 end)`
        : sql`sum(case when ${column} = true then 1 else 0 end)`;
    case 'unChecked':
      return isMultiple
        ? sql`sum(case when ${column} is null or not (${column}::jsonb @> '[true]'::jsonb) then 1 else 0 end)`
        : sql`sum(case when ${column} = false or ${column} is null then 1 else 0 end)`;
    case 'percentEmpty':
      return sql`(count(*) - count(${column})) * 100.0 / ${denominator}`;
    case 'percentFilled':
      return sql`count(${column}) * 100.0 / ${denominator}`;
    case 'percentUnique':
      return isUserLike
        ? sql`count(distinct (${column}::jsonb ->> 'id')) * 100.0 / ${denominator}`
        : sql`count(distinct ${column}) * 100.0 / ${denominator}`;
    case 'percentChecked':
      return isMultiple
        ? sql`sum(case when ${column}::jsonb @> '[true]'::jsonb then 1 else 0 end) * 100.0 / ${denominator}`
        : sql`sum(case when ${column} = true then 1 else 0 end) * 100.0 / ${denominator}`;
    case 'percentUnChecked':
      return isMultiple
        ? sql`sum(case when ${column} is null or not (${column}::jsonb @> '[true]'::jsonb) then 1 else 0 end) * 100.0 / ${denominator}`
        : sql`sum(case when ${column} = false or ${column} is null then 1 else 0 end) * 100.0 / ${denominator}`;
    case 'earliestDate':
      return sql`min(${column})`;
    case 'latestDate':
      return sql`max(${column})`;
    case 'dateRangeOfDays':
      return sql`extract(day from (max(${column}) - min(${column})))::integer`;
    case 'dateRangeOfMonths':
      return sql`(
        extract(year from age(max(${column}), min(${column}))) * 12 +
        extract(month from age(max(${column}), min(${column})))
      )::integer`;
    case 'totalAttachmentSize':
      return sql`sum(coalesce((
        select sum((element.value ->> 'size')::integer)
        from jsonb_array_elements(coalesce(${column}::jsonb, '[]'::jsonb)) as element(value)
      ), 0))`;
  }
};

export const normalizeTableRecordAggregationValue = (
  value: unknown,
  statisticFunc: TableRecordAggregationFunction
): number | string | null => {
  if (value == null) return percentFunctions.includes(statisticFunc) ? 0 : null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint' || typeof value === 'number') return Number(value);
  if (
    statisticFunc !== 'earliestDate' &&
    statisticFunc !== 'latestDate' &&
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return String(value);
};
