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
  value: RawBuilder<unknown>,
  statisticFunc: TableRecordAggregationFunction,
  field?: Field,
  predicate?: RawBuilder<unknown>
): RawBuilder<unknown> => {
  const filter = predicate ? sql` filter (where ${predicate})` : sql``;
  const fieldType = field?.type().toString();
  const valueType = field?.accept(new FieldValueTypeVisitor())._unsafeUnwrap();
  const isMultiple = valueType?.isMultipleCellValue.toBoolean() ?? false;
  const isUserLike =
    fieldType !== undefined && ['user', 'createdBy', 'lastModifiedBy'].includes(fieldType);
  const flattenedValues = sql`jsonb_array_elements_text(
    jsonb_path_query_array(
      coalesce(jsonb_agg(${value}::jsonb) filter (where ${
        predicate ? sql`(${predicate}) and ${value} is not null` : sql`${value} is not null`
      }), '[]'::jsonb),
      '$[*][*]'
    )
  ) as flattened(value)`;
  const numericValue = sql`nullif(regexp_replace(value, '[^0-9.+-]', '', 'g'), '')::double precision`;
  const count = sql`count(*)${filter}`;
  const filled = sql`count(${value})${filter}`;
  const denominator = sql`greatest(${count}, 1)`;

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

  const identity = isUserLike ? sql`(${value}::jsonb ->> 'id')` : value;
  const checked = isMultiple
    ? sql`sum(case when ${value}::jsonb @> '[true]'::jsonb then 1 else 0 end)${filter}`
    : sql`sum(case when ${value} = true then 1 else 0 end)${filter}`;
  const unchecked = isMultiple
    ? sql`sum(case when ${value} is null or not (${value}::jsonb @> '[true]'::jsonb) then 1 else 0 end)${filter}`
    : sql`sum(case when ${value} = false or ${value} is null then 1 else 0 end)${filter}`;
  const minimum = sql`min(${value})${filter}`;
  const maximum = sql`max(${value})${filter}`;
  switch (statisticFunc) {
    case 'count':
      return count;
    case 'empty':
      return sql`${count} - ${filled}`;
    case 'filled':
      return filled;
    case 'unique':
      return sql`count(distinct ${identity})${filter}`;
    case 'max':
      return maximum;
    case 'min':
      return minimum;
    case 'sum':
      return sql`sum(${value})${filter}`;
    case 'average':
      return sql`avg(${value})${filter}`;
    case 'checked':
      return checked;
    case 'unChecked':
      return unchecked;
    case 'percentEmpty':
      return sql`(${count} - ${filled}) * 100.0 / ${denominator}`;
    case 'percentFilled':
      return sql`${filled} * 100.0 / ${denominator}`;
    case 'percentUnique':
      return sql`count(distinct ${identity})${filter} * 100.0 / ${denominator}`;
    case 'percentChecked':
      return predicate
        ? sql`coalesce(${checked}, 0) * 100.0 / ${denominator}`
        : sql`${checked} * 100.0 / ${denominator}`;
    case 'percentUnChecked':
      return predicate
        ? sql`coalesce(${unchecked}, 0) * 100.0 / ${denominator}`
        : sql`${unchecked} * 100.0 / ${denominator}`;
    case 'earliestDate':
      return minimum;
    case 'latestDate':
      return maximum;
    case 'dateRangeOfDays':
      return sql`extract(day from (${maximum} - ${minimum}))::integer`;
    case 'dateRangeOfMonths':
      return sql`(
        extract(year from age(${maximum}, ${minimum})) * 12 +
        extract(month from age(${maximum}, ${minimum}))
      )::integer`;
    case 'totalAttachmentSize':
      return sql`sum(coalesce((
        select sum((element.value ->> 'size')::integer)
        from jsonb_array_elements(coalesce(${value}::jsonb, '[]'::jsonb)) as element(value)
      ), 0))${filter}`;
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
