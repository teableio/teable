import * as core from '@teable/v2-core';
import type { DomainError } from '@teable/v2-core';
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

const fieldIsUserOrLink = (field: core.Field): boolean => {
  const type = field.type().toString();
  return type === 'user' || type === 'createdBy' || type === 'lastModifiedBy' || type === 'link';
};

const buildUserLinkIdArray = (
  columnRef: RecordConditionWhere,
  isMultiple: boolean
): RecordConditionWhere => {
  const path = isMultiple ? sql.raw("'$[*].id'") : sql.raw("'$.id'");
  const fallback = isMultiple ? sql.raw("'[]'::jsonb") : sql.raw("'{}'::jsonb");
  return sql`jsonb_path_query_array(COALESCE(to_jsonb(${columnRef}), ${fallback}), ${path})`;
};

const buildJsonbTextArray = (jsonArray: RecordConditionWhere): RecordConditionWhere => {
  return sql`COALESCE((SELECT array_agg(value) FROM jsonb_array_elements_text(${jsonArray}) AS value), ARRAY[]::text[])`;
};

/**
 * Options for TableRecordConditionWhereVisitor.
 */
export interface TableRecordConditionWhereVisitorOptions {
  /**
   * Optional table alias to prefix column references.
   * When set, column references become `{tableAlias}.{column}` instead of just `{column}`.
   * This is needed for lateral join subqueries where the foreign table uses an alias (e.g. 'f').
   */
  tableAlias?: string;
  /**
   * Optional host table alias for field reference values (when isSymbol is true).
   * When conditional lookups use field references, the referenced field is from the host table (e.g. 't'),
   * while the filter field is from the foreign table (tableAlias, e.g. 'f').
   * This generates SQL like: "f"."Status" = "t"."StatusFilter"
   */
  hostTableAlias?: string;
}

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

const resolveColumn = (field: core.Field, tableAlias?: string): Result<string, DomainError> => {
  return safeTry<string, DomainError>(function* () {
    const dbFieldName = yield* field.dbFieldName();
    const column = yield* dbFieldName.value();
    // If tableAlias is provided, return prefixed column name for use in subqueries
    return ok(tableAlias ? `${tableAlias}.${column}` : column);
  }).mapErr((error) =>
    core.domainError.invariant({
      message: `Missing db field name for field ${field.id().toString()}: ${error.message}`,
      code: 'invariant.missing_db_field_name',
      details: { fieldId: field.id().toString(), cause: error.message },
    })
  );
};

const resolvePrimitiveOperand = (
  value: core.RecordConditionValue,
  tableAlias?: string,
  hostTableAlias?: string
): Result<PrimitiveOperand, DomainError> => {
  if (core.isRecordConditionLiteralValue(value)) {
    return ok({ kind: 'literal', value: value.toValue() });
  }
  if (core.isRecordConditionFieldReferenceValue(value)) {
    return safeTry<PrimitiveOperand, DomainError>(function* () {
      // Field references use hostTableAlias if provided (for conditional lookup cross-table comparisons)
      const alias = hostTableAlias ?? tableAlias;
      const column = yield* resolveColumn(value.field(), alias);
      return ok({ kind: 'field', column });
    });
  }
  return err(core.domainError.unexpected({ message: 'Record condition requires primitive value' }));
};

const resolveListValues = (
  value: core.RecordConditionValue
): Result<ReadonlyArray<Primitive>, DomainError> => {
  if (!core.isRecordConditionLiteralListValue(value)) {
    return err(core.domainError.unexpected({ message: 'Record condition requires list value' }));
  }
  return ok(value.toValues());
};

const resolveDateValue = (
  value: core.RecordConditionValue
): Result<core.RecordConditionDateValue, DomainError> => {
  if (!core.isRecordConditionDateValue(value)) {
    return err(core.domainError.unexpected({ message: 'Record condition requires date value' }));
  }
  return ok(value);
};

const fieldIsMultiple = (field: core.Field): Result<boolean, DomainError> => {
  return safeTry<boolean, DomainError>(function* () {
    const multiplicity = yield* field.isMultipleCellValue();
    return ok(multiplicity.isMultiple());
  });
};

const resolveDateFormatting = (field: core.Field): core.DateTimeFormatting | undefined => {
  const fieldType = field.type().toString();
  if (fieldType === 'lookup' || fieldType === 'conditionalLookup') {
    const innerResult =
      fieldType === 'lookup'
        ? (field as core.LookupField).innerField()
        : (field as core.ConditionalLookupField).innerField();
    if (innerResult.isOk()) {
      return resolveDateFormatting(innerResult.value);
    }
  }
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
): Result<{ start: string; end: string }, DomainError> => {
  return safeTry<{ start: string; end: string }, DomainError>(function* () {
    const mode = value.mode();
    const numberOfDays = value.numberOfDays();
    const exactDate = value.exactDate();
    const dateUtil = new DateUtil(value.timeZone().toString());

    const requireExactDate = (): Result<string, DomainError> => {
      if (!exactDate) {
        return err(core.domainError.unexpected({ message: 'Date condition requires exactDate' }));
      }
      return ok(exactDate);
    };

    const requireNumberOfDays = (): Result<number, DomainError> => {
      if (numberOfDays == null) {
        return err(
          core.domainError.unexpected({ message: 'Date condition requires numberOfDays' })
        );
      }
      return ok(numberOfDays);
    };

    const computeDateRangeForFixedDays = (
      method: 'date' | 'tomorrow' | 'yesterday'
    ): [Dayjs, Dayjs] => {
      const target = dateUtil[method]();
      return [target.startOf('day'), target.endOf('day')];
    };

    const calculateDateRangeForOffsetDays = (
      isPast: boolean
    ): Result<[Dayjs, Dayjs], DomainError> => {
      return requireNumberOfDays().map((days) => {
        const offset = isPast ? -days : days;
        const target = dateUtil.offsetDay(offset);
        return [target.startOf('day'), target.endOf('day')];
      });
    };

    const determineExactDateRange = (): Result<[Dayjs, Dayjs], DomainError> => {
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

    const determineExactFormatDateRange = (): Result<[Dayjs, Dayjs], DomainError> => {
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
    ): Result<[Dayjs, Dayjs], DomainError> => {
      if (days == null) {
        return err(
          core.domainError.unexpected({ message: 'Date condition requires numberOfDays' })
        );
      }
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

    const resolveRange = (): Result<[Dayjs, Dayjs], DomainError> => {
      return match(mode)
        .returnType<Result<[Dayjs, Dayjs], DomainError>>()
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
          safeTry<[Dayjs, Dayjs], DomainError>(function* () {
            const days = yield* requireNumberOfDays();
            const range = yield* generateOffsetDateRange(true, 'day', days);
            return ok(range);
          })
        )
        .with('nextNumberOfDays', () =>
          safeTry<[Dayjs, Dayjs], DomainError>(function* () {
            const days = yield* requireNumberOfDays();
            const range = yield* generateOffsetDateRange(false, 'day', days);
            return ok(range);
          })
        )
        .otherwise(() => err(core.domainError.validation({ message: 'Unsupported date mode' })));
    };

    const range = yield* resolveRange();
    return ok({ start: range[0].toISOString(), end: range[1].toISOString() });
  });
};

const buildIsEmptyCondition = (
  field: core.Field,
  tableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    const column = yield* resolveColumn(field, tableAlias);
    const valueType = yield* field.accept(new core.FieldValueTypeVisitor());
    const columnRef = sql.ref(column);
    const isMultiple = valueType.isMultipleCellValue.isMultiple();

    if (isMultiple) {
      return ok(sql`(${columnRef} is null) or (jsonb_array_length(to_jsonb(${columnRef})) = 0)`);
    }

    if (fieldIsJson(field)) {
      return ok(sql`(${columnRef} is null) or (to_jsonb(${columnRef}) = '{}'::jsonb)`);
    }

    if (valueType.cellValueType.equals(core.CellValueType.string())) {
      return ok(sql`(${columnRef} is null) or (${columnRef} = '')`);
    }

    return ok(sql`${columnRef} is null`);
  });
};

const buildIsNotEmptyCondition = (
  field: core.Field,
  tableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    const column = yield* resolveColumn(field, tableAlias);
    const valueType = yield* field.accept(new core.FieldValueTypeVisitor());
    const columnRef = sql.ref(column);
    const isMultiple = valueType.isMultipleCellValue.isMultiple();

    if (isMultiple) {
      return ok(
        sql`(${columnRef} is not null) and (jsonb_array_length(to_jsonb(${columnRef})) > 0)`
      );
    }

    if (fieldIsJson(field)) {
      return ok(sql`(${columnRef} is not null) and (to_jsonb(${columnRef}) != '{}'::jsonb)`);
    }

    if (valueType.cellValueType.equals(core.CellValueType.string())) {
      return ok(sql`(${columnRef} is not null) and (${columnRef} != '')`);
    }

    return ok(sql`${columnRef} is not null`);
  });
};

const buildIsCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  tableAlias?: string,
  hostTableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
    const columnRef = sql.ref(column);
    if (core.isRecordConditionDateValue(value)) {
      const range = yield* resolveDateRange(value, resolveDateFormatting(field));
      return ok(sql`${columnRef} between ${range.start} and ${range.end}`);
    }
    const operand = yield* resolvePrimitiveOperand(value, tableAlias, hostTableAlias);
    if (
      operand.kind === 'field' &&
      core.isRecordConditionFieldReferenceValue(value) &&
      fieldIsUserOrLink(field)
    ) {
      const referenceField = value.field();
      if (fieldIsUserOrLink(referenceField)) {
        const leftIsMultiple = yield* fieldIsMultiple(field);
        const rightIsMultiple = yield* fieldIsMultiple(referenceField);
        const rightColumnRef = sql.ref(operand.column);

        if (!leftIsMultiple && !rightIsMultiple) {
          return ok(
            sql`jsonb_extract_path_text(to_jsonb(${columnRef}), 'id') = jsonb_extract_path_text(to_jsonb(${rightColumnRef}), 'id')`
          );
        }

        const leftIds = buildUserLinkIdArray(columnRef, leftIsMultiple);
        const rightIds = buildUserLinkIdArray(rightColumnRef, rightIsMultiple);

        if (leftIsMultiple && rightIsMultiple) {
          return ok(sql`(${leftIds} @> ${rightIds}) and (${rightIds} @> ${leftIds})`);
        }

        return ok(sql`jsonb_exists_any(${leftIds}, ${buildJsonbTextArray(rightIds)})`);
      }
    }

    const right = operand.kind === 'field' ? sql.ref(operand.column) : sql`${operand.value}`;
    return ok(sql`${columnRef} = ${right}`);
  });
};

const buildIsNotCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  tableAlias?: string,
  hostTableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
    const columnRef = sql.ref(column);
    if (core.isRecordConditionDateValue(value)) {
      const range = yield* resolveDateRange(value, resolveDateFormatting(field));
      return ok(
        sql`(${columnRef} not between ${range.start} and ${range.end} or ${columnRef} is null)`
      );
    }
    const operand = yield* resolvePrimitiveOperand(value, tableAlias, hostTableAlias);
    if (
      operand.kind === 'field' &&
      core.isRecordConditionFieldReferenceValue(value) &&
      fieldIsUserOrLink(field)
    ) {
      const referenceField = value.field();
      if (fieldIsUserOrLink(referenceField)) {
        const leftIsMultiple = yield* fieldIsMultiple(field);
        const rightIsMultiple = yield* fieldIsMultiple(referenceField);
        const rightColumnRef = sql.ref(operand.column);

        if (!leftIsMultiple && !rightIsMultiple) {
          return ok(
            sql`jsonb_extract_path_text(to_jsonb(${columnRef}), 'id') IS DISTINCT FROM jsonb_extract_path_text(to_jsonb(${rightColumnRef}), 'id')`
          );
        }

        const leftIds = buildUserLinkIdArray(columnRef, leftIsMultiple);
        const rightIds = buildUserLinkIdArray(rightColumnRef, rightIsMultiple);

        if (leftIsMultiple && rightIsMultiple) {
          return ok(sql`not ((${leftIds} @> ${rightIds}) and (${rightIds} @> ${leftIds}))`);
        }

        return ok(sql`not jsonb_exists_any(${leftIds}, ${buildJsonbTextArray(rightIds)})`);
      }
    }

    const right = operand.kind === 'field' ? sql.ref(operand.column) : sql`${operand.value}`;
    // Use IS DISTINCT FROM to match v1 behavior: NULL values should pass "isNot" checks.
    // Plain `!=` returns NULL when the column is NULL, silently excluding those rows.
    return ok(sql`${columnRef} is distinct from ${right}`);
  });
};

const buildContainsCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  isNegative: boolean,
  tableAlias?: string,
  hostTableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
    const operand = yield* resolvePrimitiveOperand(value, tableAlias, hostTableAlias);
    if (operand.kind === 'literal' && typeof operand.value !== 'string') {
      return err(
        core.domainError.unexpected({ message: 'Record condition requires string value' })
      );
    }
    const columnRef = sql.ref(column);
    const pattern =
      operand.kind === 'field'
        ? sql`'%' || ${sql.ref(operand.column)} || '%'`
        : `%${operand.value}%`;
    // Use COALESCE for negative match to align with v1:
    // v1 uses `COALESCE(col, '') NOT LIKE ...` so NULL rows pass the "does not contain" check.
    // Without COALESCE, `NULL not like '%val%'` returns NULL (falsy), excluding NULL rows.
    const condition = isNegative
      ? sql`coalesce(${columnRef}, '') not like ${pattern}`
      : sql`${columnRef} like ${pattern}`;
    return ok(condition);
  });
};

const buildNumericComparisonCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  operator: ComparisonOperator,
  tableAlias?: string,
  hostTableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
    const operand = yield* resolvePrimitiveOperand(value, tableAlias, hostTableAlias);
    if (operand.kind === 'literal' && typeof operand.value !== 'number') {
      return err(
        core.domainError.unexpected({ message: 'Record condition requires numeric value' })
      );
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
  operator: ComparisonOperator,
  tableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
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
  value: core.RecordConditionValue | undefined,
  tableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
    const dateValue = yield* resolveDateValue(value);
    const range = yield* resolveDateRange(dateValue, resolveDateFormatting(field));
    const columnRef = sql.ref(column);
    return ok(sql`${columnRef} between ${range.start} and ${range.end}`);
  });
};

const buildListCondition = (
  field: core.Field,
  value: core.RecordConditionValue | undefined,
  kind: ListOperatorKind,
  tableAlias?: string
): Result<RecordConditionWhere, DomainError> => {
  return safeTry<RecordConditionWhere, DomainError>(function* () {
    if (!value)
      return err(core.domainError.unexpected({ message: 'Record condition requires value' }));
    const column = yield* resolveColumn(field, tableAlias);
    const values = yield* resolveListValues(value);
    if (values.length === 0)
      return err(core.domainError.unexpected({ message: 'Record condition requires list values' }));
    const isMultiple = yield* fieldIsMultiple(field);
    const columnRef = sql.ref(column);
    if (!isMultiple) {
      const list = sql.join(values.map((entry) => sql`${entry}`));
      const isNegative = kind === 'none' || kind === 'notExact';
      if (isNegative) {
        // Use COALESCE to match v1 behavior: NULL values should pass "not in" checks.
        // Without COALESCE, `NULL NOT IN (...)` returns NULL (falsy) and excludes the row,
        // but v1 treats NULL as '' which passes the NOT IN check.
        return ok(sql`coalesce(${columnRef}, '') not in (${list})`);
      }
      return ok(sql`${columnRef} in (${list})`);
    }

    const textValues = values.map((entry) => String(entry));
    const textArray = sql`array[${sql.join(textValues.map((entry) => sql`${entry}`))}]`;
    const valueArray = sql`array[${sql.join(values.map((entry) => sql`${entry}`))}]`;
    const jsonbColumn = sql`to_jsonb(${columnRef})`;
    const jsonbArray = sql`to_jsonb(${valueArray})`;

    if (kind === 'any') return ok(sql`${jsonbColumn} ?| ${textArray}`);
    if (kind === 'none') {
      // Use COALESCE to match v1 behavior: NULL values should pass "none" checks.
      const coalesced = sql`to_jsonb(coalesce(${columnRef}, '[]'::jsonb))`;
      return ok(sql`not (${coalesced} ?| ${textArray})`);
    }
    if (kind === 'all') return ok(sql`${jsonbColumn} ?& ${textArray}`);
    if (kind === 'exact') {
      return ok(sql`(${jsonbColumn} @> ${jsonbArray}) and (${jsonbColumn} <@ ${jsonbArray})`);
    }
    // notExact: use COALESCE so NULL values are included (match v1 behavior)
    const coalescedNE = sql`to_jsonb(coalesce(${columnRef}, '[]'::jsonb))`;
    return ok(sql`not ((${coalescedNE} @> ${jsonbArray}) and (${coalescedNE} <@ ${jsonbArray}))`);
  });
};

export class TableRecordConditionWhereVisitor
  extends core.AbstractSpecFilterVisitor<RecordConditionWhere>
  implements core.ITableRecordConditionSpecVisitor<RecordConditionWhere>
{
  private readonly tableAlias: string | undefined;
  private readonly hostTableAlias: string | undefined;

  constructor(options?: TableRecordConditionWhereVisitorOptions) {
    super();
    this.tableAlias = options?.tableAlias;
    this.hostTableAlias = options?.hostTableAlias;
  }

  clone(): this {
    return new TableRecordConditionWhereVisitor({
      tableAlias: this.tableAlias,
      hostTableAlias: this.hostTableAlias,
    }) as this;
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

  visitRecordById(spec: core.RecordByIdSpec): Result<RecordConditionWhere, DomainError> {
    const column = this.tableAlias ? `${this.tableAlias}.__id` : '__id';
    return this.addCondition(sql`${sql.ref(column)} = ${spec.recordId().toString()}`);
  }

  visitRecordByIds(spec: core.RecordByIdsSpec): Result<RecordConditionWhere, DomainError> {
    const column = this.tableAlias ? `${this.tableAlias}.__id` : '__id';
    const ids = spec.recordIds().map((recordId) => recordId.toString());
    if (ids.length === 0) {
      return this.addCondition(sql`1 = 0`);
    }
    return this.addCondition(sql`${sql.ref(column)} in (${sql.join(ids)})`);
  }

  visitSingleLineTextIs(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitSingleLineTextIsNot(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitSingleLineTextContains(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitSingleLineTextDoesNotContain(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitSingleLineTextIsEmpty(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitSingleLineTextIsNotEmpty(
    spec: core.SingleLineTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitLongTextIs(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitLongTextIsNot(spec: core.LongTextConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitLongTextContains(
    spec: core.LongTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitLongTextDoesNotContain(
    spec: core.LongTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitLongTextIsEmpty(
    spec: core.LongTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitLongTextIsNotEmpty(
    spec: core.LongTextConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitButtonIs(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitButtonIsNot(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitButtonContains(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitButtonDoesNotContain(
    spec: core.ButtonConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitButtonIsEmpty(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitButtonIsNotEmpty(spec: core.ButtonConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitNumberIs(spec: core.NumberConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitNumberIsNot(spec: core.NumberConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitNumberIsGreater(spec: core.NumberConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitNumberIsGreaterEqual(
    spec: core.NumberConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitNumberIsLess(spec: core.NumberConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitNumberIsLessEqual(
    spec: core.NumberConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitNumberIsEmpty(spec: core.NumberConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitNumberIsNotEmpty(spec: core.NumberConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitRatingIs(spec: core.RatingConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitRatingIsNot(spec: core.RatingConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitRatingIsGreater(spec: core.RatingConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitRatingIsGreaterEqual(
    spec: core.RatingConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitRatingIsLess(spec: core.RatingConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitRatingIsLessEqual(
    spec: core.RatingConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitRatingIsEmpty(spec: core.RatingConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitRatingIsNotEmpty(spec: core.RatingConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitCheckboxIs(spec: core.CheckboxConditionSpec): Result<RecordConditionWhere, DomainError> {
    // Checkbox fields store NULL for unchecked (not false).
    // When filtering for "is false/unchecked", we must match both false AND NULL
    // to align with v1 behavior: `(col = false OR col IS NULL)`.
    const value = spec.value();
    if (value && core.isRecordConditionLiteralValue(value) && value.toValue() === false) {
      const alias = this.tableAlias;
      return this.addConditionResult(
        safeTry<RecordConditionWhere, DomainError>(function* () {
          const column = yield* resolveColumn(spec.field(), alias);
          const columnRef = sql.ref(column);
          return ok(sql`(${columnRef} = false or ${columnRef} is null)`);
        })
      );
    }
    return this.applyIs(spec.field(), spec.value());
  }

  visitDateIs(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitDateIsNot(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitDateIsWithIn(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitDateIsBefore(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitDateIsAfter(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitDateIsOnOrBefore(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitDateIsOnOrAfter(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  visitDateIsEmpty(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitDateIsNotEmpty(spec: core.DateConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitSingleSelectIs(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitSingleSelectIsNot(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitSingleSelectIsAnyOf(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitSingleSelectIsNoneOf(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitSingleSelectIsEmpty(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitSingleSelectIsNotEmpty(
    spec: core.SingleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitMultipleSelectHasAnyOf(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitMultipleSelectHasAllOf(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitMultipleSelectIsExactly(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitMultipleSelectIsNotExactly(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitMultipleSelectHasNoneOf(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitMultipleSelectIsEmpty(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitMultipleSelectIsNotEmpty(
    spec: core.MultipleSelectConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitAttachmentIsEmpty(
    spec: core.AttachmentConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitAttachmentIsNotEmpty(
    spec: core.AttachmentConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitUserIs(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitUserIsNot(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitUserIsAnyOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitUserIsNoneOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitUserHasAnyOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitUserHasAllOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitUserIsExactly(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitUserIsNotExactly(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitUserHasNoneOf(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitUserIsEmpty(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitUserIsNotEmpty(spec: core.UserConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitLinkIs(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitLinkIsNot(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitLinkIsAnyOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitLinkIsNoneOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitLinkHasAnyOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitLinkHasAllOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitLinkIsExactly(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitLinkIsNotExactly(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitLinkHasNoneOf(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitLinkContains(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitLinkDoesNotContain(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitLinkIsEmpty(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitLinkIsNotEmpty(spec: core.LinkConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitFormulaIs(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitFormulaIsNot(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitFormulaContains(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitFormulaDoesNotContain(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitFormulaIsEmpty(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitFormulaIsNotEmpty(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitFormulaIsGreater(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitFormulaIsGreaterEqual(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitFormulaIsLess(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitFormulaIsLessEqual(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitFormulaIsAnyOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitFormulaIsNoneOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitFormulaHasAnyOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitFormulaHasAllOf(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitFormulaIsNotExactly(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitFormulaHasNoneOf(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitFormulaIsExactly(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitFormulaIsWithIn(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitFormulaIsBefore(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitFormulaIsAfter(spec: core.FormulaConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitFormulaIsOnOrBefore(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitFormulaIsOnOrAfter(
    spec: core.FormulaConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  visitRollupIs(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitRollupIsNot(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitRollupContains(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitRollupDoesNotContain(
    spec: core.RollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitRollupIsEmpty(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitRollupIsNotEmpty(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitRollupIsGreater(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitRollupIsGreaterEqual(
    spec: core.RollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitRollupIsLess(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitRollupIsLessEqual(
    spec: core.RollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitRollupIsAnyOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitRollupIsNoneOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitRollupHasAnyOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitRollupHasAllOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitRollupIsNotExactly(
    spec: core.RollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitRollupHasNoneOf(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitRollupIsExactly(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitRollupIsWithIn(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitRollupIsBefore(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitRollupIsAfter(spec: core.RollupConditionSpec): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitRollupIsOnOrBefore(
    spec: core.RollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitRollupIsOnOrAfter(
    spec: core.RollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  // ConditionalRollup condition specs - same behavior as Rollup
  visitConditionalRollupIs(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitConditionalRollupIsNot(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitConditionalRollupContains(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitConditionalRollupDoesNotContain(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitConditionalRollupIsEmpty(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitConditionalRollupIsNotEmpty(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitConditionalRollupIsGreater(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>');
  }

  visitConditionalRollupIsGreaterEqual(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '>=');
  }

  visitConditionalRollupIsLess(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<');
  }

  visitConditionalRollupIsLessEqual(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyNumericComparison(spec.field(), spec.value(), '<=');
  }

  visitConditionalRollupIsAnyOf(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitConditionalRollupIsNoneOf(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitConditionalRollupHasAnyOf(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitConditionalRollupHasAllOf(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitConditionalRollupIsNotExactly(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitConditionalRollupHasNoneOf(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitConditionalRollupIsExactly(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  visitConditionalRollupIsWithIn(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsWithin(spec.field(), spec.value());
  }

  visitConditionalRollupIsBefore(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<');
  }

  visitConditionalRollupIsAfter(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>');
  }

  visitConditionalRollupIsOnOrBefore(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '<=');
  }

  visitConditionalRollupIsOnOrAfter(
    spec: core.ConditionalRollupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDateComparison(spec.field(), spec.value(), '>=');
  }

  // ConditionalLookup condition specs - same behavior as Lookup (multi-select style)
  visitConditionalLookupIs(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIs(spec.field(), spec.value());
  }

  visitConditionalLookupIsNot(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNot(spec.field(), spec.value());
  }

  visitConditionalLookupContains(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyContains(spec.field(), spec.value());
  }

  visitConditionalLookupDoesNotContain(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyDoesNotContain(spec.field(), spec.value());
  }

  visitConditionalLookupIsEmpty(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsEmpty(spec.field());
  }

  visitConditionalLookupIsNotEmpty(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyIsNotEmpty(spec.field());
  }

  visitConditionalLookupIsAnyOf(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitConditionalLookupIsNoneOf(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitConditionalLookupHasAnyOf(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'any');
  }

  visitConditionalLookupHasAllOf(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'all');
  }

  visitConditionalLookupIsNotExactly(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'notExact');
  }

  visitConditionalLookupHasNoneOf(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'none');
  }

  visitConditionalLookupIsExactly(
    spec: core.ConditionalLookupConditionSpec
  ): Result<RecordConditionWhere, DomainError> {
    return this.applyListCondition(spec.field(), spec.value(), 'exact');
  }

  private addCondition(condition: RecordConditionWhere): Result<RecordConditionWhere, DomainError> {
    return safeTry<RecordConditionWhere, DomainError>(
      function* (this: TableRecordConditionWhereVisitor) {
        yield* this.addCond(condition);
        return ok(condition);
      }.bind(this)
    );
  }

  private addConditionResult(
    conditionResult: Result<RecordConditionWhere, DomainError>
  ): Result<RecordConditionWhere, DomainError> {
    return safeTry<RecordConditionWhere, DomainError>(
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
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(
      buildIsCondition(field, value, this.tableAlias, this.hostTableAlias)
    );
  }

  private applyIsNot(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(
      buildIsNotCondition(field, value, this.tableAlias, this.hostTableAlias)
    );
  }

  private applyContains(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(
      buildContainsCondition(field, value, false, this.tableAlias, this.hostTableAlias)
    );
  }

  private applyDoesNotContain(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(
      buildContainsCondition(field, value, true, this.tableAlias, this.hostTableAlias)
    );
  }

  private applyIsEmpty(field: core.Field): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(buildIsEmptyCondition(field, this.tableAlias));
  }

  private applyIsNotEmpty(field: core.Field): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(buildIsNotEmptyCondition(field, this.tableAlias));
  }

  private applyNumericComparison(
    field: core.Field,
    value: core.RecordConditionValue | undefined,
    operator: ComparisonOperator
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(
      buildNumericComparisonCondition(field, value, operator, this.tableAlias, this.hostTableAlias)
    );
  }

  private applyDateComparison(
    field: core.Field,
    value: core.RecordConditionValue | undefined,
    operator: ComparisonOperator
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(
      buildDateComparisonCondition(field, value, operator, this.tableAlias)
    );
  }

  private applyIsWithin(
    field: core.Field,
    value: core.RecordConditionValue | undefined
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(buildIsWithinCondition(field, value, this.tableAlias));
  }

  private applyListCondition(
    field: core.Field,
    value: core.RecordConditionValue | undefined,
    kind: ListOperatorKind
  ): Result<RecordConditionWhere, DomainError> {
    return this.addConditionResult(buildListCondition(field, value, kind, this.tableAlias));
  }
}
