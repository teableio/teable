import * as core from '@teable/v2-core';
import dayjs, { type Dayjs, type ManipulateType } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { match } from 'ts-pattern';

dayjs.extend(utc);
dayjs.extend(timezone);

type Primitive = string | number | boolean;

type ListOperatorKind = 'any' | 'none' | 'all' | 'exact' | 'notExact';

type ComparisonOperator = '>' | '>=' | '<' | '<=';

export type RecordConditionWhere = ReturnType<typeof sql>;

type PrimitiveOperand = { kind: 'literal'; value: Primitive } | { kind: 'field'; column: string };

const jsonSpecResult = core.Field.specs().isJson().build();

const fieldIsJson = (field: core.Field): boolean => {
  if (jsonSpecResult.isErr()) return false;
  return jsonSpecResult.value.isSatisfiedBy(field);
};

class DateUtil {
  constructor(private readonly timeZone: string) {}

  date(value?: dayjs.ConfigType): Dayjs {
    return dayjs(value).utc().tz(this.timeZone);
  }

  offset(dateField: ManipulateType, offset: number, value = this.date()): Dayjs {
    if (offset === 0) return value;
    return value[offset > 0 ? 'add' : 'subtract'](Math.abs(offset), dateField);
  }

  offsetDay(offset: number, value = this.date()): Dayjs {
    return this.offset('day', offset, value);
  }

  offsetWeek(offset: number, value = this.date()): Dayjs {
    return this.offset('week', offset, value);
  }

  offsetMonth(offset: number, value = this.date()): Dayjs {
    return this.offset('month', offset, value);
  }

  tomorrow(): Dayjs {
    return this.offsetDay(1);
  }

  yesterday(): Dayjs {
    return this.offsetDay(-1);
  }

  lastWeek(): Dayjs {
    return this.offsetWeek(-1);
  }

  nextWeek(): Dayjs {
    return this.offsetWeek(1);
  }

  lastMonth(): Dayjs {
    return this.offsetMonth(-1);
  }

  nextMonth(): Dayjs {
    return this.offsetMonth(1);
  }
}

const resolveColumn = (field: core.Field): Result<string, string> => {
  return safeTry<string, string>(function* () {
    const dbFieldName = yield* field.dbFieldName();
    const column = yield* dbFieldName.value();
    return ok(column);
  }).mapErr((error) => `Missing db field name for field ${field.id().toString()}: ${error}`);
};

const resolvePrimitiveOperand = (
  value: core.RecordConditionValue
): Result<PrimitiveOperand, string> => {
  if (core.isRecordConditionLiteralValue(value)) {
    return ok({ kind: 'literal', value: value.toValue() });
  }
  if (core.isRecordConditionFieldReferenceValue(value)) {
    return safeTry<PrimitiveOperand, string>(function* () {
      const column = yield* resolveColumn(value.field());
      return ok({ kind: 'field', column });
    });
  }
  return err('Record condition requires primitive value');
};

const resolveListValues = (
  value: core.RecordConditionValue
): Result<ReadonlyArray<Primitive>, string> => {
  if (!core.isRecordConditionLiteralListValue(value)) {
    return err('Record condition requires list value');
  }
  return ok(value.toValues());
};

const resolveDateValue = (
  value: core.RecordConditionValue
): Result<core.RecordConditionDateValue, string> => {
  if (!core.isRecordConditionDateValue(value)) {
    return err('Record condition requires date value');
  }
  return ok(value);
};

const fieldIsMultiple = (field: core.Field): Result<boolean, string> => {
  return safeTry<boolean, string>(function* () {
    const valueType = yield* field.accept(new core.FieldValueTypeVisitor());
    return ok(valueType.isMultipleCellValue.isMultiple());
  });
};

const resolveDateFormatting = (field: core.Field): core.DateTimeFormatting | undefined => {
  const fieldType = field.type().toString();
  if (fieldType === 'date') {
    return (field as core.DateField).formatting();
  }
  if (fieldType === 'createdTime') {
    return (field as core.CreatedTimeField).formatting();
  }
  if (fieldType === 'lastModifiedTime') {
    return (field as core.LastModifiedTimeField).formatting();
  }
  if (fieldType === 'formula') {
    const formatting = (field as core.FormulaField).formatting();
    return formatting instanceof core.DateTimeFormatting ? formatting : undefined;
  }
  if (fieldType === 'rollup') {
    const formatting = (field as core.RollupField).formatting();
    return formatting instanceof core.DateTimeFormatting ? formatting : undefined;
  }
  return undefined;
};

const resolveDateRange = (
  value: core.RecordConditionDateValue,
  formatting?: core.DateTimeFormatting
): Result<{ start: string; end: string }, string> => {
  return safeTry<{ start: string; end: string }, string>(function* () {
    const mode = value.mode();
    const numberOfDays = value.numberOfDays();
    const exactDate = value.exactDate();
    const dateUtil = new DateUtil(value.timeZone().toString());

    const requireExactDate = (): Result<string, string> => {
      if (!exactDate) return err('Date condition requires exactDate');
      return ok(exactDate);
    };

    const requireNumberOfDays = (): Result<number, string> => {
      if (numberOfDays == null) return err('Date condition requires numberOfDays');
      return ok(numberOfDays);
    };

    const computeDateRangeForFixedDays = (
      method: 'date' | 'tomorrow' | 'yesterday'
    ): [Dayjs, Dayjs] => {
      const target = dateUtil[method]();
      return [target.startOf('day'), target.endOf('day')];
    };

    const calculateDateRangeForOffsetDays = (isPast: boolean): Result<[Dayjs, Dayjs], string> => {
      return requireNumberOfDays().map((days) => {
        const offset = isPast ? -days : days;
        const target = dateUtil.offsetDay(offset);
        return [target.startOf('day'), target.endOf('day')];
      });
    };

    const determineExactDateRange = (): Result<[Dayjs, Dayjs], string> => {
      return requireExactDate().map((raw) => {
        const parsed = dateUtil.date(raw);
        return [parsed.startOf('day'), parsed.endOf('day')];
      });
    };

    const determineDateUnit = (): 'day' | 'month' | 'year' => {
      const dateFormat = formatting?.date() ?? core.DateFormattingPreset.ISO;
      return match(dateFormat)
        .returnType<'day' | 'month' | 'year'>()
        .with(core.DateFormattingPreset.Y, () => 'year')
        .with(core.DateFormattingPreset.YM, core.DateFormattingPreset.M, () => 'month')
        .otherwise(() => 'day');
    };

    const determineExactFormatDateRange = (): Result<[Dayjs, Dayjs], string> => {
      return requireExactDate().map((raw) => {
        const parsed = dateUtil.date(raw);
        const unit = determineDateUnit();
        return [parsed.startOf(unit), parsed.endOf(unit)];
      });
    };

    const generateOffsetDateRange = (
      isPast: boolean,
      unit: 'day' | 'week' | 'month' | 'year',
      days?: number
    ): Result<[Dayjs, Dayjs], string> => {
      if (days == null) return err('Date condition requires numberOfDays');
      const currentDate = dateUtil.date();
      const startOfDay = currentDate.startOf('day');
      const endOfDay = currentDate.endOf('day');
      const startDate = isPast ? dateUtil.offset(unit, -days, endOfDay).startOf('day') : startOfDay;
      const endDate = isPast ? endOfDay : dateUtil.offset(unit, days, startOfDay).endOf('day');
      return ok([startDate, endDate]);
    };

    const generateRelativeDateFromCurrentDateRange = (
      relativeMode: 'current' | 'next' | 'last',
      unit: 'week' | 'month' | 'year'
    ): [Dayjs, Dayjs] => {
      dayjs.locale(dayjs.locale(), {
        weekStart: 1,
      });
      const cursorDate = match(relativeMode)
        .with('next', () => dateUtil.date().add(1, unit))
        .with('last', () => dateUtil.date().subtract(1, unit))
        .with('current', () => dateUtil.date())
        .exhaustive();
      return [cursorDate.startOf(unit).startOf('day'), cursorDate.endOf(unit).endOf('day')];
    };

    const resolveRange = (): Result<[Dayjs, Dayjs], string> => {
      return match(mode)
        .returnType<Result<[Dayjs, Dayjs], string>>()
        .with('today', () => ok(computeDateRangeForFixedDays('date')))
        .with('tomorrow', () => ok(computeDateRangeForFixedDays('tomorrow')))
        .with('yesterday', () => ok(computeDateRangeForFixedDays('yesterday')))
        .with('oneWeekAgo', () =>
          ok([dateUtil.lastWeek().startOf('day'), dateUtil.lastWeek().endOf('day')])
        )
        .with('oneWeekFromNow', () =>
          ok([dateUtil.nextWeek().startOf('day'), dateUtil.nextWeek().endOf('day')])
        )
        .with('oneMonthAgo', () =>
          ok([dateUtil.lastMonth().startOf('day'), dateUtil.lastMonth().endOf('day')])
        )
        .with('oneMonthFromNow', () =>
          ok([dateUtil.nextMonth().startOf('day'), dateUtil.nextMonth().endOf('day')])
        )
        .with('daysAgo', () => calculateDateRangeForOffsetDays(true))
        .with('daysFromNow', () => calculateDateRangeForOffsetDays(false))
        .with('exactDate', () => determineExactDateRange())
        .with('exactFormatDate', () => determineExactFormatDateRange())
        .with('currentWeek', () => ok(generateRelativeDateFromCurrentDateRange('current', 'week')))
        .with('currentMonth', () =>
          ok(generateRelativeDateFromCurrentDateRange('current', 'month'))
        )
        .with('currentYear', () => ok(generateRelativeDateFromCurrentDateRange('current', 'year')))
        .with('lastWeek', () => ok(generateRelativeDateFromCurrentDateRange('last', 'week')))
        .with('lastMonth', () => ok(generateRelativeDateFromCurrentDateRange('last', 'month')))
        .with('lastYear', () => ok(generateRelativeDateFromCurrentDateRange('last', 'year')))
        .with('nextWeekPeriod', () => ok(generateRelativeDateFromCurrentDateRange('next', 'week')))
        .with('nextMonthPeriod', () =>
          ok(generateRelativeDateFromCurrentDateRange('next', 'month'))
        )
        .with('nextYearPeriod', () => ok(generateRelativeDateFromCurrentDateRange('next', 'year')))
        .with('pastWeek', () => generateOffsetDateRange(true, 'week', 1))
        .with('pastMonth', () => generateOffsetDateRange(true, 'month', 1))
        .with('pastYear', () => generateOffsetDateRange(true, 'year', 1))
        .with('nextWeek', () => generateOffsetDateRange(false, 'week', 1))
        .with('nextMonth', () => generateOffsetDateRange(false, 'month', 1))
        .with('nextYear', () => generateOffsetDateRange(false, 'year', 1))
        .with('pastNumberOfDays', () =>
          safeTry<[Dayjs, Dayjs], string>(function* () {
            const days = yield* requireNumberOfDays();
            const range = yield* generateOffsetDateRange(true, 'day', days);
            return ok(range);
          })
        )
        .with('nextNumberOfDays', () =>
          safeTry<[Dayjs, Dayjs], string>(function* () {
            const days = yield* requireNumberOfDays();
            const range = yield* generateOffsetDateRange(false, 'day', days);
            return ok(range);
          })
        )
        .otherwise(() => err('Unsupported date mode'));
    };

    const range = yield* resolveRange();
    return ok({ start: range[0].toISOString(), end: range[1].toISOString() });
  });
};

const buildIsEmptyCondition = (field: core.Field): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    const column = yield* resolveColumn(field);
    const valueType = yield* field.accept(new core.FieldValueTypeVisitor());
    const columnRef = sql.ref(column);
    const isMultiple = valueType.isMultipleCellValue.isMultiple();

    if (isMultiple) {
      return ok(sql`(${columnRef} is null) or (jsonb_array_length(to_jsonb(${columnRef})) = 0)`);
    }

    if (fieldIsJson(field)) {
      return ok(sql`(${columnRef} is null) or (jsonb_object_length(to_jsonb(${columnRef})) = 0)`);
    }

    if (valueType.cellValueType.equals(core.CellValueType.string())) {
      return ok(sql`(${columnRef} is null) or (${columnRef} = '')`);
    }

    return ok(sql`${columnRef} is null`);
  });
};

const buildIsNotEmptyCondition = (field: core.Field): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    const column = yield* resolveColumn(field);
    const valueType = yield* field.accept(new core.FieldValueTypeVisitor());
    const columnRef = sql.ref(column);
    const isMultiple = valueType.isMultipleCellValue.isMultiple();

    if (isMultiple) {
      return ok(
        sql`(${columnRef} is not null) and (jsonb_array_length(to_jsonb(${columnRef})) > 0)`
      );
    }

    if (fieldIsJson(field)) {
      return ok(
        sql`(${columnRef} is not null) and (jsonb_object_length(to_jsonb(${columnRef})) > 0)`
      );
    }

    if (valueType.cellValueType.equals(core.CellValueType.string())) {
      return ok(sql`(${columnRef} is not null) and (${columnRef} != '')`);
    }

    return ok(sql`${columnRef} is not null`);
  });
};

const buildIsCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const columnRef = sql.ref(column);
    if (core.isRecordConditionDateValue(value)) {
      const range = yield* resolveDateRange(value, resolveDateFormatting(field));
      return ok(sql`${columnRef} between ${range.start} and ${range.end}`);
    }
    const operand = yield* resolvePrimitiveOperand(value);
    const right = operand.kind === 'field' ? sql.ref(operand.column) : sql`${operand.value}`;
    return ok(sql`${columnRef} = ${right}`);
  });
};

const buildIsNotCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const columnRef = sql.ref(column);
    if (core.isRecordConditionDateValue(value)) {
      const range = yield* resolveDateRange(value, resolveDateFormatting(field));
      return ok(
        sql`(${columnRef} not between ${range.start} and ${range.end} or ${columnRef} is null)`
      );
    }
    const operand = yield* resolvePrimitiveOperand(value);
    const right = operand.kind === 'field' ? sql.ref(operand.column) : sql`${operand.value}`;
    return ok(sql`${columnRef} != ${right}`);
  });
};

const buildContainsCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  isNegative: boolean
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const operand = yield* resolvePrimitiveOperand(value);
    if (operand.kind === 'literal' && typeof operand.value !== 'string') {
      return err('Record condition requires string value');
    }
    const columnRef = sql.ref(column);
    const pattern =
      operand.kind === 'field'
        ? sql`'%' || ${sql.ref(operand.column)} || '%'`
        : `%${operand.value}%`;
    const condition = isNegative
      ? sql`${columnRef} not like ${pattern}`
      : sql`${columnRef} like ${pattern}`;
    return ok(condition);
  });
};

const buildNumericComparisonCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  operator: ComparisonOperator
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const operand = yield* resolvePrimitiveOperand(value);
    if (operand.kind === 'literal' && typeof operand.value !== 'number') {
      return err('Record condition requires numeric value');
    }
    const columnRef = sql.ref(column);
    const right = operand.kind === 'field' ? sql.ref(operand.column) : sql`${operand.value}`;
    if (operator === '>') return ok(sql`${columnRef} > ${right}`);
    if (operator === '>=') return ok(sql`${columnRef} >= ${right}`);
    if (operator === '<') return ok(sql`${columnRef} < ${right}`);
    return ok(sql`${columnRef} <= ${right}`);
  });
};

const buildDateComparisonCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  operator: ComparisonOperator
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const dateValue = yield* resolveDateValue(value);
    const range = yield* resolveDateRange(dateValue, resolveDateFormatting(field));
    const columnRef = sql.ref(column);
    const boundary = operator === '>' || operator === '<=' ? range.end : range.start;
    const right = sql`${boundary}`;
    if (operator === '>') return ok(sql`${columnRef} > ${right}`);
    if (operator === '>=') return ok(sql`${columnRef} >= ${right}`);
    if (operator === '<') return ok(sql`${columnRef} < ${right}`);
    return ok(sql`${columnRef} <= ${right}`);
  });
};

const buildIsWithinCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const dateValue = yield* resolveDateValue(value);
    const range = yield* resolveDateRange(dateValue, resolveDateFormatting(field));
    const columnRef = sql.ref(column);
    return ok(sql`${columnRef} between ${range.start} and ${range.end}`);
  });
};

const buildListCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  kind: ListOperatorKind
): Result<RecordConditionWhere, string> => {
  return safeTry<RecordConditionWhere, string>(function* () {
    if (!value) return err('Record condition requires value');
    const column = yield* resolveColumn(field);
    const values = yield* resolveListValues(value);
    if (values.length === 0) return err('Record condition requires list values');
    const isMultiple = yield* fieldIsMultiple(field);
    const columnRef = sql.ref(column);
    if (!isMultiple) {
      const list = sql.join(values.map((entry) => sql`${entry}`));
      const isNegative = kind === 'none' || kind === 'notExact';
      return ok(isNegative ? sql`${columnRef} not in (${list})` : sql`${columnRef} in (${list})`);
    }

    const textValues = values.map((entry) => String(entry));
    const textArray = sql`array[${sql.join(textValues.map((entry) => sql`${entry}`))}]`;
    const valueArray = sql`array[${sql.join(values.map((entry) => sql`${entry}`))}]`;
    const jsonbColumn = sql`to_jsonb(${columnRef})`;
    const jsonbArray = sql`to_jsonb(${valueArray})`;

    if (kind === 'any') return ok(sql`${jsonbColumn} ?| ${textArray}`);
    if (kind === 'none') return ok(sql`not (${jsonbColumn} ?| ${textArray})`);
    if (kind === 'all') return ok(sql`${jsonbColumn} ?& ${textArray}`);
    if (kind === 'exact') {
      return ok(sql`(${jsonbColumn} @> ${jsonbArray}) and (${jsonbColumn} <@ ${jsonbArray})`);
    }
    return ok(sql`not ((${jsonbColumn} @> ${jsonbArray}) and (${jsonbColumn} <@ ${jsonbArray}))`);
  });
};

export class TableRecordConditionWhereVisitor
  extends core.AbstractSpecFilterVisitor<RecordConditionWhere>
  implements core.ITableRecordConditionSpecVisitor<RecordConditionWhere>
{
  clone(): this {
    return new TableRecordConditionWhereVisitor() as this;
  }

  and(left: RecordConditionWhere, right: RecordConditionWhere): RecordConditionWhere {
    return sql`(${left}) and (${right})`;
  }

  or(left: RecordConditionWhere, right: RecordConditionWhere): RecordConditionWhere {
    return sql`(${left}) or (${right})`;
  }

  not(inner: RecordConditionWhere): RecordConditionWhere {
    return sql`not (${inner})`;
  }

  visitSingleLineTextIs(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitSingleLineTextIsNot(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitSingleLineTextContains(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitSingleLineTextDoesNotContain(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitSingleLineTextIsEmpty(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitSingleLineTextIsNotEmpty(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitLongTextIs(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitLongTextIsNot(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitLongTextContains(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitLongTextDoesNotContain(
    spec: core.LongTextConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitLongTextIsEmpty(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitLongTextIsNotEmpty(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitButtonIs(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitButtonIsNot(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitButtonContains(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitButtonDoesNotContain(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitButtonIsEmpty(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitButtonIsNotEmpty(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitNumberIs(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitNumberIsNot(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitNumberIsGreater(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitNumberIsGreaterEqual(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitNumberIsLess(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitNumberIsLessEqual(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitNumberIsEmpty(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitNumberIsNotEmpty(spec: core.NumberConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitRatingIs(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitRatingIsNot(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitRatingIsGreater(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitRatingIsGreaterEqual(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitRatingIsLess(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitRatingIsLessEqual(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitRatingIsEmpty(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitRatingIsNotEmpty(spec: core.RatingConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitCheckboxIs(spec: core.CheckboxConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitDateIs(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitDateIsNot(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitDateIsWithIn(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitDateIsBefore(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitDateIsAfter(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitDateIsOnOrBefore(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitDateIsOnOrAfter(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  visitDateIsEmpty(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitDateIsNotEmpty(spec: core.DateConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitSingleSelectIs(spec: core.SingleSelectConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitSingleSelectIsNot(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitSingleSelectIsAnyOf(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitSingleSelectIsNoneOf(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitSingleSelectIsEmpty(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitSingleSelectIsNotEmpty(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitMultipleSelectHasAnyOf(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitMultipleSelectHasAllOf(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitMultipleSelectIsExactly(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitMultipleSelectIsNotExactly(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitMultipleSelectHasNoneOf(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitMultipleSelectIsEmpty(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitMultipleSelectIsNotEmpty(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitAttachmentIsEmpty(spec: core.AttachmentConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitAttachmentIsNotEmpty(
    spec: core.AttachmentConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitUserIs(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitUserIsNot(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitUserIsAnyOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitUserIsNoneOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitUserHasAnyOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitUserHasAllOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitUserIsExactly(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitUserIsNotExactly(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitUserHasNoneOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitUserIsEmpty(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitUserIsNotEmpty(spec: core.UserConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitLinkIs(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitLinkIsNot(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitLinkIsAnyOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitLinkIsNoneOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitLinkHasAnyOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitLinkHasAllOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitLinkIsExactly(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitLinkIsNotExactly(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitLinkHasNoneOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitLinkContains(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitLinkDoesNotContain(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitLinkIsEmpty(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitLinkIsNotEmpty(spec: core.LinkConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitFormulaIs(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitFormulaIsNot(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitFormulaContains(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitFormulaDoesNotContain(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitFormulaIsEmpty(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitFormulaIsNotEmpty(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitFormulaIsGreater(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitFormulaIsGreaterEqual(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitFormulaIsLess(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitFormulaIsLessEqual(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitFormulaIsAnyOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitFormulaIsNoneOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitFormulaHasAnyOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitFormulaHasAllOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitFormulaIsNotExactly(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitFormulaHasNoneOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitFormulaIsExactly(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitFormulaIsWithIn(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitFormulaIsBefore(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitFormulaIsAfter(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitFormulaIsOnOrBefore(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitFormulaIsOnOrAfter(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  visitRollupIs(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitRollupIsNot(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitRollupContains(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitRollupDoesNotContain(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitRollupIsEmpty(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsEmpty(spec.field());
  }

  visitRollupIsNotEmpty(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitRollupIsGreater(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitRollupIsGreaterEqual(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitRollupIsLess(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitRollupIsLessEqual(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitRollupIsAnyOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitRollupIsNoneOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitRollupHasAnyOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitRollupHasAllOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitRollupIsNotExactly(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitRollupHasNoneOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitRollupIsExactly(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitRollupIsWithIn(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitRollupIsBefore(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitRollupIsAfter(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitRollupIsOnOrBefore(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitRollupIsOnOrAfter(spec: core.RollupConditionSpec): Result<RecordConditionWhere, string> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  private addCondition(condition: RecordConditionWhere): Result<RecordConditionWhere, string> {
    return safeTry<RecordConditionWhere, string>(
      function* (this: TableRecordConditionWhereVisitor) {
        yield* this.addCond(condition);
        return ok(condition);
      }.bind(this)
    );
  }

  private addConditionResult(
    conditionResult: Result<RecordConditionWhere, string>
  ): Result<RecordConditionWhere, string> {
    return safeTry<RecordConditionWhere, string>(
      function* (this: TableRecordConditionWhereVisitor) {
        const condition = yield* conditionResult;
        yield* this.addCond(condition);
        return ok(condition);
      }.bind(this)
    );
  }

  private applyIs(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildIsCondition(field, value));
  }

  private applyIsNot(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildIsNotCondition(field, value));
  }

  private applyContains(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildContainsCondition(field, value, false));
  }

  private applyDoesNotContain(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildContainsCondition(field, value, true));
  }

  private applyIsEmpty(field: core.Field): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildIsEmptyCondition(field));
  }

  private applyIsNotEmpty(field: core.Field): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildIsNotEmptyCondition(field));
  }

  private applyNumericComparison(
    field: core.Field,
    value: core.RecordConditionValue | undefined,
    operator: ComparisonOperator
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildNumericComparisonCondition(field, value, operator));
  }

  private applyDateComparison(
    field: core.Field,
    value: core.RecordConditionValue | undefined,
    operator: ComparisonOperator
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildDateComparisonCondition(field, value, operator));
  }

  private applyIsWithin(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildIsWithinCondition(field, value));
  }

  private applyListCondition(
    field: core.Field,
    value: core.RecordConditionValue | undefined,
    kind: ListOperatorKind
  ): Result<RecordConditionWhere, string> {
    return this.addConditionResult(buildListCondition(field, value, kind));
  }
}
