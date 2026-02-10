/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import { FunctionName } from '@teable/v2-core';

import {
  DATE_ADD_UNIT_ALIASES,
  DATE_ADD_UNIT_SQL,
  DATETIME_DIFF_UNIT_ALIASES,
  DATETIME_DIFF_UNIT_SQL,
  FormulaSqlPgExpressionBuilder,
  IS_SAME_UNIT_ALIASES,
  IS_SAME_UNIT_SQL,
} from './FormulaSqlPgExpressionBuilder';
import type { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { buildErrorLiteral, extractJsonScalarText, sqlStringLiteral } from './PgSqlHelpers';
import {
  buildErrorMessageSql,
  combineErrorConditions,
  guardValueSql,
  makeExpr,
  type SqlExpr,
} from './SqlExpression';
import { buildDatetimeFormatSql } from './utils/datetime-format.util';

const NULL_DOUBLE_PRECISION = 'NULL::double precision';
const NULL_BOOLEAN = 'NULL::boolean';
const NULL_TIMESTAMPTZ = 'NULL::timestamptz';

export class FormulaSqlPgFunctions extends FormulaSqlPgExpressionBuilder {
  private readonly functionHandlers: Partial<Record<FunctionName, (params: SqlExpr[]) => SqlExpr>>;

  constructor(translator: FormulaSqlPgTranslator) {
    super(translator);
    this.functionHandlers = {
      [FunctionName.Sum]: (params) => this.sum(params),
      [FunctionName.Average]: (params) => this.average(params),
      [FunctionName.Max]: (params) => this.max(params),
      [FunctionName.Min]: (params) => this.min(params),
      [FunctionName.Round]: (params) => this.round(params),
      [FunctionName.RoundUp]: (params) => this.roundUp(params),
      [FunctionName.RoundDown]: (params) => this.roundDown(params),
      [FunctionName.Ceiling]: (params) => this.ceiling(params),
      [FunctionName.Floor]: (params) => this.floor(params),
      [FunctionName.Even]: (params) => this.even(params),
      [FunctionName.Odd]: (params) => this.odd(params),
      [FunctionName.Int]: (params) => this.int(params),
      [FunctionName.Abs]: (params) => this.abs(params),
      [FunctionName.Sqrt]: (params) => this.sqrt(params),
      [FunctionName.Power]: (params) => this.power(params),
      [FunctionName.Exp]: (params) => this.exp(params),
      [FunctionName.Log]: (params) => this.log(params),
      [FunctionName.Mod]: (params) => this.mod(params),
      [FunctionName.Value]: (params) => this.value(params),

      [FunctionName.Concatenate]: (params) => this.concatenate(params),
      [FunctionName.Find]: (params) => this.find(params),
      [FunctionName.Search]: (params) => this.search(params),
      [FunctionName.Mid]: (params) => this.mid(params),
      [FunctionName.Left]: (params) => this.left(params),
      [FunctionName.Right]: (params) => this.right(params),
      [FunctionName.Replace]: (params) => this.replace(params),
      [FunctionName.RegExpReplace]: (params) => this.regexpReplace(params),
      [FunctionName.Substitute]: (params) => this.substitute(params),
      [FunctionName.Lower]: (params) => this.lower(params),
      [FunctionName.Upper]: (params) => this.upper(params),
      [FunctionName.Rept]: (params) => this.rept(params),
      [FunctionName.Trim]: (params) => this.trim(params),
      [FunctionName.Len]: (params) => this.len(params),
      [FunctionName.T]: (params) => this.t(params),
      [FunctionName.EncodeUrlComponent]: (params) => this.encodeUrlComponent(params),

      [FunctionName.If]: (params) => this.ifFunc(params),
      [FunctionName.Switch]: (params) => this.switchFunc(params),
      [FunctionName.And]: (params) => this.and(params),
      [FunctionName.Or]: (params) => this.or(params),
      [FunctionName.Not]: (params) => this.not(params),
      [FunctionName.Xor]: (params) => this.xor(params),
      [FunctionName.Blank]: () => makeExpr('NULL', 'string', false),
      [FunctionName.Error]: (params) => this.errorFunc(params),
      [FunctionName.IsError]: (params) => this.isError(params),

      [FunctionName.Today]: () => makeExpr('CURRENT_DATE', 'datetime', false),
      [FunctionName.Now]: () => makeExpr('NOW()', 'datetime', false),
      [FunctionName.Year]: (params) => this.extractDatePart('YEAR', params),
      [FunctionName.Month]: (params) => this.extractDatePart('MONTH', params),
      [FunctionName.WeekNum]: (params) => this.extractDatePart('WEEK', params),
      [FunctionName.Weekday]: (params) => this.extractDatePart('DOW', params),
      [FunctionName.Day]: (params) => this.extractDatePart('DAY', params),
      [FunctionName.Hour]: (params) => this.extractDatePart('HOUR', params),
      [FunctionName.Minute]: (params) => this.extractDatePart('MINUTE', params),
      [FunctionName.Second]: (params) => this.extractDatePart('SECOND', params),
      [FunctionName.FromNow]: (params) => this.fromNow(params),
      [FunctionName.ToNow]: (params) => this.toNow(params),
      [FunctionName.DatetimeDiff]: (params) => this.datetimeDiff(params),
      [FunctionName.Workday]: (params) => this.workday(params),
      [FunctionName.WorkdayDiff]: (params) => this.workdayDiff(params),
      [FunctionName.IsSame]: (params) => this.isSame(params),
      [FunctionName.IsAfter]: (params) => this.isAfter(params),
      [FunctionName.IsBefore]: (params) => this.isBefore(params),
      [FunctionName.DateAdd]: (params) => this.dateAdd(params),
      [FunctionName.Datestr]: (params) => this.datestr(params),
      [FunctionName.Timestr]: (params) => this.timestr(params),
      [FunctionName.DatetimeFormat]: (params) => this.datetimeFormat(params),
      [FunctionName.DatetimeParse]: (params) => this.datetimeParse(params),
      [FunctionName.SetLocale]: (params) => this.setLocale(params),
      [FunctionName.SetTimezone]: (params) => this.setTimezone(params),
      [FunctionName.CreatedTime]: (params) => this.createdTime(params),
      [FunctionName.LastModifiedTime]: (params) => this.lastModifiedTime(params),
      [FunctionName.RecordId]: () =>
        makeExpr(`"${this.translator.tableAlias}".__id`, 'string', false),
      [FunctionName.AutoNumber]: () =>
        makeExpr(`"${this.translator.tableAlias}".__auto_number`, 'number', false),

      [FunctionName.ArrayJoin]: (params) => this.arrayJoin(params),
      [FunctionName.ArrayCompact]: (params) => this.arrayCompact(params),
      [FunctionName.ArrayUnique]: (params) => this.arrayUnique(params),
      [FunctionName.ArrayFlatten]: (params) => this.arrayFlatten(params),
      [FunctionName.TextAll]: (params) => this.textAll(params),
      [FunctionName.Count]: (params) => this.count(params),
      [FunctionName.CountA]: (params) => this.countA(params),
      [FunctionName.CountAll]: (params) => this.countAll(params),
    };
  }

  getHandlers(): Partial<Record<FunctionName, (params: SqlExpr[]) => SqlExpr>> {
    return this.functionHandlers;
  }
  private sum(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) {
      return makeExpr('0', 'number', false);
    }
    const arrays = params.filter((p) => p.isArray);
    if (arrays.length === 1) {
      const arrayExpr = arrays[0];
      const scalars = params
        .filter((p) => p !== arrayExpr)
        .map((p) => this.coerceToNumber(p, 'sum'));
      const scalarTerms = scalars.map((p) => p.valueSql);
      const scalarErrorCondition = combineErrorConditions([arrayExpr, ...scalars]);
      const scalarErrorMessage = buildErrorMessageSql(
        [arrayExpr, ...scalars],
        buildErrorLiteral('TYPE', 'cannot_cast_to_number')
      );
      const normalizedArray = this.normalizeArrayExpr(arrayExpr);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        arrayExpr.errorConditionSql,
        arrayExpr.errorMessageSql
      );
      const elementNumber = this.coerceToNumber(elemExpr, 'sum');
      const arraySumSql = `(SELECT SUM(${elementNumber.valueSql})
        FROM jsonb_array_elements(${normalizedArray}) AS t(elem)
      )`;
      const scalarSumSql = scalarTerms.length ? `(${scalarTerms.join(' + ')})` : '';
      const sumSql = scalarSumSql ? `(${arraySumSql}) + ${scalarSumSql}` : arraySumSql;
      const valueSql = guardValueSql(sumSql, scalarErrorCondition);
      return makeExpr(valueSql, 'number', false, scalarErrorCondition, scalarErrorMessage);
    }

    const numericParams = params.map((param) => this.coerceToNumber(param, 'sum'));
    const errorCondition = combineErrorConditions(numericParams);
    const errorMessage = buildErrorMessageSql(
      numericParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const sumSql = numericParams.map((param) => param.valueSql).join(' + ');
    const valueSql = guardValueSql(sumSql.length ? `(${sumSql})` : '0', errorCondition);
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private average(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('NULL', 'number', false);
    const arrays = params.filter((p) => p.isArray);
    if (arrays.length === 1) {
      const arrayExpr = arrays[0];
      const scalars = params
        .filter((p) => p !== arrayExpr)
        .map((p) => this.coerceToNumber(p, 'average'));
      const scalarTerms = scalars.map((p) => p.valueSql);
      const scalarErrorCondition = combineErrorConditions([arrayExpr, ...scalars]);
      const scalarErrorMessage = buildErrorMessageSql(
        [arrayExpr, ...scalars],
        buildErrorLiteral('TYPE', 'cannot_cast_to_number')
      );
      const normalizedArray = this.normalizeArrayExpr(arrayExpr);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        arrayExpr.errorConditionSql,
        arrayExpr.errorMessageSql
      );
      const elementNumber = this.coerceToNumber(elemExpr, 'average');
      const arraySumSql = `(SELECT SUM(${elementNumber.valueSql})
        FROM jsonb_array_elements(${normalizedArray}) AS t(elem)
      )`;
      const arrayCountSql = `jsonb_array_length(${normalizedArray})`;
      const scalarSumSql = scalarTerms.length ? `(${scalarTerms.join(' + ')})` : '';
      const totalSumSql = scalarSumSql ? `(${arraySumSql}) + ${scalarSumSql}` : arraySumSql;
      const totalCountSql = scalarTerms.length
        ? `(${arrayCountSql}) + ${scalarTerms.length}`
        : arrayCountSql;
      const denominatorSql = `NULLIF(${totalCountSql}, 0)`;
      const valueSql = guardValueSql(`(${totalSumSql}) / ${denominatorSql}`, scalarErrorCondition);
      return makeExpr(valueSql, 'number', false, scalarErrorCondition, scalarErrorMessage);
    }
    const numericParams = params.map((param) => this.coerceToNumber(param, 'average'));
    const errorCondition = combineErrorConditions(numericParams);
    const errorMessage = buildErrorMessageSql(
      numericParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const sumSql = numericParams.map((param) => param.valueSql).join(' + ');
    const numerator = sumSql.length ? `(${sumSql})` : '0';
    const valueSql = guardValueSql(
      `(CASE WHEN ${params.length} = 0 THEN NULL ELSE ${numerator} / ${params.length} END)`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private max(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('NULL', 'number', false);
    const preferDatetime = params[0]?.valueType === 'datetime';
    const arrays = params.filter((p) => p.isArray);
    if (arrays.length === 1) {
      const arrayExpr = arrays[0];
      const scalars = params
        .filter((p) => p !== arrayExpr)
        .map((p) => (preferDatetime ? this.coerceToDatetime(p) : this.coerceToNumber(p, 'max')));
      const scalarTerms = scalars.map((p) => p.valueSql);
      const scalarErrorCondition = combineErrorConditions([arrayExpr, ...scalars]);
      const scalarErrorMessage = buildErrorMessageSql(
        [arrayExpr, ...scalars],
        buildErrorLiteral('TYPE', 'cannot_cast_to_number')
      );
      const normalizedArray = this.normalizeArrayExpr(arrayExpr);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        arrayExpr.errorConditionSql,
        arrayExpr.errorMessageSql
      );
      const elementValue = preferDatetime
        ? this.coerceToDatetime(elemExpr)
        : this.coerceToNumber(elemExpr, 'max');
      const arrayMaxSql = `(SELECT MAX(${elementValue.valueSql})
        FROM jsonb_array_elements(${normalizedArray}) AS t(elem)
      )`;
      const candidates = [arrayMaxSql, ...scalarTerms];
      const valueSql = guardValueSql(`GREATEST(${candidates.join(', ')})`, scalarErrorCondition);
      return makeExpr(
        valueSql,
        preferDatetime ? 'datetime' : 'number',
        false,
        scalarErrorCondition,
        scalarErrorMessage
      );
    }
    const typedParams = params.map((param) =>
      preferDatetime ? this.coerceToDatetime(param) : this.coerceToNumber(param, 'max')
    );
    const errorCondition = combineErrorConditions(typedParams);
    const errorMessage = buildErrorMessageSql(
      typedParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const valueSql = guardValueSql(
      `GREATEST(${typedParams.map((p) => p.valueSql).join(', ')})`,
      errorCondition
    );
    return makeExpr(
      valueSql,
      preferDatetime ? 'datetime' : 'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private min(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('NULL', 'number', false);
    const preferDatetime = params[0]?.valueType === 'datetime';
    const arrays = params.filter((p) => p.isArray);
    if (arrays.length === 1) {
      const arrayExpr = arrays[0];
      const scalars = params
        .filter((p) => p !== arrayExpr)
        .map((p) => (preferDatetime ? this.coerceToDatetime(p) : this.coerceToNumber(p, 'min')));
      const scalarTerms = scalars.map((p) => p.valueSql);
      const scalarErrorCondition = combineErrorConditions([arrayExpr, ...scalars]);
      const scalarErrorMessage = buildErrorMessageSql(
        [arrayExpr, ...scalars],
        buildErrorLiteral('TYPE', 'cannot_cast_to_number')
      );
      const normalizedArray = this.normalizeArrayExpr(arrayExpr);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        arrayExpr.errorConditionSql,
        arrayExpr.errorMessageSql
      );
      const elementValue = preferDatetime
        ? this.coerceToDatetime(elemExpr)
        : this.coerceToNumber(elemExpr, 'min');
      const arrayMinSql = `(SELECT MIN(${elementValue.valueSql})
        FROM jsonb_array_elements(${normalizedArray}) AS t(elem)
      )`;
      const candidates = [arrayMinSql, ...scalarTerms];
      const valueSql = guardValueSql(`LEAST(${candidates.join(', ')})`, scalarErrorCondition);
      return makeExpr(
        valueSql,
        preferDatetime ? 'datetime' : 'number',
        false,
        scalarErrorCondition,
        scalarErrorMessage
      );
    }
    const typedParams = params.map((param) =>
      preferDatetime ? this.coerceToDatetime(param) : this.coerceToNumber(param, 'min')
    );
    const errorCondition = combineErrorConditions(typedParams);
    const errorMessage = buildErrorMessageSql(
      typedParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const valueSql = guardValueSql(
      `LEAST(${typedParams.map((p) => p.valueSql).join(', ')})`,
      errorCondition
    );
    return makeExpr(
      valueSql,
      preferDatetime ? 'datetime' : 'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private vectorizeUnaryNumericArray(
    arrayExpr: SqlExpr,
    op: (valueSql: string) => string,
    reason: string
  ): SqlExpr {
    const normalizedArray = this.normalizeArrayExpr(arrayExpr);
    const elemExpr = makeExpr(
      extractJsonScalarText('elem'),
      'unknown',
      false,
      arrayExpr.errorConditionSql,
      arrayExpr.errorMessageSql
    );
    const elementNumber = this.coerceToNumber(elemExpr, reason);
    const elementValueSql = guardValueSql(
      op(elementNumber.valueSql),
      elementNumber.errorConditionSql
    );
    const valueSql = `(SELECT jsonb_agg(to_jsonb(${elementValueSql}) ORDER BY ord)
      FROM jsonb_array_elements(${normalizedArray}) WITH ORDINALITY AS _jae(elem, ord)
    )`;
    return makeExpr(
      valueSql,
      'number',
      true,
      arrayExpr.errorConditionSql,
      arrayExpr.errorMessageSql
    );
  }

  private round(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    const precision = params[1];
    if (!value) return makeExpr('NULL', 'number', false);
    if (value.isArray) {
      if (precision) {
        return this.vectorizeArrayScalar(
          value,
          precision,
          (leftSql, rightSql) => `ROUND(${leftSql}::numeric, ${rightSql}::integer)`,
          'round'
        );
      }
      return this.vectorizeUnaryNumericArray(
        value,
        (valueSql: string) => `ROUND(${valueSql}::numeric)`,
        'round'
      );
    }
    const numericValue = this.coerceToNumber(value, 'round');
    const numericPrecision = precision ? this.coerceToNumber(precision, 'round') : undefined;
    const errorCondition = combineErrorConditions(
      numericPrecision ? [numericValue, numericPrecision] : [numericValue]
    );
    const errorMessage = buildErrorMessageSql(
      numericPrecision ? [numericValue, numericPrecision] : [numericValue],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const valueSql = precision
      ? `ROUND(${numericValue.valueSql}::numeric, ${numericPrecision?.valueSql}::integer)`
      : `ROUND(${numericValue.valueSql}::numeric)`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private roundUp(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    const precision = params[1];
    if (!value) return makeExpr('NULL', 'number', false);
    if (value.isArray) {
      if (precision) {
        return this.vectorizeArrayScalar(
          value,
          precision,
          (leftSql, rightSql) => {
            const factor = `POWER(10, ${rightSql}::integer)`;
            return `CEIL(${leftSql} * ${factor}) / ${factor}`;
          },
          'roundup'
        );
      }
      return this.vectorizeUnaryNumericArray(
        value,
        (valueSql: string) => `CEIL(${valueSql})`,
        'roundup'
      );
    }
    const numericValue = this.coerceToNumber(value, 'roundup');
    const numericPrecision = precision ? this.coerceToNumber(precision, 'roundup') : undefined;
    const errorCondition = combineErrorConditions(
      numericPrecision ? [numericValue, numericPrecision] : [numericValue]
    );
    const errorMessage = buildErrorMessageSql(
      numericPrecision ? [numericValue, numericPrecision] : [numericValue],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    if (!precision) {
      return makeExpr(
        guardValueSql(`CEIL(${numericValue.valueSql})`, errorCondition),
        'number',
        false,
        errorCondition,
        errorMessage
      );
    }
    const factor = `POWER(10, ${numericPrecision?.valueSql}::integer)`;
    const valueSql = `CEIL(${numericValue.valueSql} * ${factor}) / ${factor}`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private roundDown(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    const precision = params[1];
    if (!value) return makeExpr('NULL', 'number', false);
    if (value.isArray) {
      if (precision) {
        return this.vectorizeArrayScalar(
          value,
          precision,
          (leftSql, rightSql) => {
            const factor = `POWER(10, ${rightSql}::integer)`;
            return `FLOOR(${leftSql} * ${factor}) / ${factor}`;
          },
          'rounddown'
        );
      }
      return this.vectorizeUnaryNumericArray(
        value,
        (valueSql: string) => `FLOOR(${valueSql})`,
        'rounddown'
      );
    }
    const numericValue = this.coerceToNumber(value, 'rounddown');
    const numericPrecision = precision ? this.coerceToNumber(precision, 'rounddown') : undefined;
    const errorCondition = combineErrorConditions(
      numericPrecision ? [numericValue, numericPrecision] : [numericValue]
    );
    const errorMessage = buildErrorMessageSql(
      numericPrecision ? [numericValue, numericPrecision] : [numericValue],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    if (!precision) {
      return makeExpr(
        guardValueSql(`FLOOR(${numericValue.valueSql})`, errorCondition),
        'number',
        false,
        errorCondition,
        errorMessage
      );
    }
    const factor = `POWER(10, ${numericPrecision?.valueSql}::integer)`;
    const valueSql = `FLOOR(${numericValue.valueSql} * ${factor}) / ${factor}`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private ceiling(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    if (value.isArray) {
      return this.vectorizeUnaryNumericArray(
        value,
        (valueSql: string) => `CEIL(${valueSql})`,
        'ceiling'
      );
    }
    const numeric = this.coerceToNumber(value, 'ceiling');
    const errorCondition = numeric.errorConditionSql;
    return makeExpr(
      guardValueSql(`CEIL(${numeric.valueSql})`, errorCondition),
      'number',
      false,
      errorCondition,
      numeric.errorMessageSql
    );
  }

  private floor(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    if (value.isArray) {
      return this.vectorizeUnaryNumericArray(
        value,
        (valueSql: string) => `FLOOR(${valueSql})`,
        'floor'
      );
    }
    const numeric = this.coerceToNumber(value, 'floor');
    const errorCondition = numeric.errorConditionSql;
    return makeExpr(
      guardValueSql(`FLOOR(${numeric.valueSql})`, errorCondition),
      'number',
      false,
      errorCondition,
      numeric.errorMessageSql
    );
  }

  private even(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const numeric = this.coerceToNumber(value, 'even');
    const valueSql = this.withValueAlias(numeric.valueSql, (ref) => {
      const rounded = `(CASE WHEN ${ref} > 0 THEN CEIL(${ref}) ELSE FLOOR(${ref}) END)`;
      const roundedNumeric = `(${rounded})::numeric`;
      return `(CASE
        WHEN MOD(${roundedNumeric}, 2::numeric) = 0 THEN ${rounded}
        WHEN ${rounded} > 0 THEN ${rounded} + 1
        ELSE ${rounded} - 1
      END)`;
    });
    return makeExpr(
      guardValueSql(valueSql, numeric.errorConditionSql),
      'number',
      false,
      numeric.errorConditionSql,
      numeric.errorMessageSql
    );
  }

  private odd(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const numeric = this.coerceToNumber(value, 'odd');
    const valueSql = this.withValueAlias(numeric.valueSql, (ref) => {
      const rounded = `(CASE WHEN ${ref} > 0 THEN CEIL(${ref}) ELSE FLOOR(${ref}) END)`;
      const roundedNumeric = `(${rounded})::numeric`;
      return `(CASE
        WHEN MOD(${roundedNumeric}, 2::numeric) <> 0 THEN ${rounded}
        WHEN ${rounded} >= 0 THEN ${rounded} + 1
        ELSE ${rounded} - 1
      END)`;
    });
    return makeExpr(
      guardValueSql(valueSql, numeric.errorConditionSql),
      'number',
      false,
      numeric.errorConditionSql,
      numeric.errorMessageSql
    );
  }

  private int(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    if (value.isArray) {
      return this.vectorizeUnaryNumericArray(
        value,
        (valueSql: string) => `FLOOR(${valueSql})`,
        'int'
      );
    }
    const numeric = this.coerceToNumber(value, 'int');
    return makeExpr(
      guardValueSql(`FLOOR(${numeric.valueSql})`, numeric.errorConditionSql),
      'number',
      false,
      numeric.errorConditionSql,
      numeric.errorMessageSql
    );
  }

  private abs(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const numeric = this.coerceToNumber(value, 'abs');
    return makeExpr(
      guardValueSql(`ABS(${numeric.valueSql})`, numeric.errorConditionSql),
      'number',
      false,
      numeric.errorConditionSql,
      numeric.errorMessageSql
    );
  }

  private sqrt(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const numeric = this.coerceToNumber(value, 'sqrt');
    return makeExpr(
      guardValueSql(`SQRT(${numeric.valueSql})`, numeric.errorConditionSql),
      'number',
      false,
      numeric.errorConditionSql,
      numeric.errorMessageSql
    );
  }

  private power(params: SqlExpr[]): SqlExpr {
    const base = params[0];
    const exp = params[1];
    if (!base || !exp) return makeExpr('NULL', 'number', false);
    const baseNumeric = this.coerceToNumber(base, 'power');
    const expNumeric = this.coerceToNumber(exp, 'power');
    const errorCondition = combineErrorConditions([baseNumeric, expNumeric]);
    const errorMessage = buildErrorMessageSql(
      [baseNumeric, expNumeric],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const valueSql = guardValueSql(
      `POWER(${baseNumeric.valueSql}, ${expNumeric.valueSql})`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private exp(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const numeric = this.coerceToNumber(value, 'exp');
    return makeExpr(
      guardValueSql(`EXP(${numeric.valueSql})`, numeric.errorConditionSql),
      'number',
      false,
      numeric.errorConditionSql,
      numeric.errorMessageSql
    );
  }

  private log(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    const base = params[1];
    if (!value) return makeExpr('NULL', 'number', false);
    const numericValue = this.coerceToNumber(value, 'log');
    if (!base) {
      return makeExpr(
        guardValueSql(`LN(${numericValue.valueSql})`, numericValue.errorConditionSql),
        'number',
        false,
        numericValue.errorConditionSql,
        numericValue.errorMessageSql
      );
    }
    const numericBase = this.coerceToNumber(base, 'log');
    const errorCondition = combineErrorConditions([numericValue, numericBase]);
    const errorMessage = buildErrorMessageSql(
      [numericValue, numericBase],
      buildErrorLiteral('TYPE', 'cannot_cast_to_number')
    );
    const baseLog = `LN(${numericBase.valueSql})`;
    const valueSql = guardValueSql(
      `(LN(${numericValue.valueSql}) / NULLIF(${baseLog}, 0))`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private mod(params: SqlExpr[]): SqlExpr {
    const dividend = params[0];
    const divisor = params[1];
    if (!dividend || !divisor) return makeExpr('NULL', 'number', false);
    const left = this.coerceToNumber(dividend, 'mod');
    const right = this.coerceToNumber(divisor, 'mod');
    const divZeroCondition = `(${right.valueSql}) = 0`;
    const errorCondition = combineErrorConditions([
      left,
      right,
      makeExpr(
        'NULL',
        'number',
        false,
        divZeroCondition,
        buildErrorLiteral('DIV0', 'division_by_zero')
      ),
    ]);
    const errorMessage = buildErrorMessageSql(
      [
        left,
        right,
        makeExpr(
          'NULL',
          'number',
          false,
          divZeroCondition,
          buildErrorLiteral('DIV0', 'division_by_zero')
        ),
      ],
      buildErrorLiteral('DIV0', 'division_by_zero')
    );
    const valueSql = guardValueSql(
      `MOD(${left.valueSql}::numeric, ${right.valueSql}::numeric)::double precision`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private value(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    if (!textExpr) return makeExpr('NULL', 'number', false);
    if (textExpr.isArray) {
      return this.vectorizeUnaryNumericArray(textExpr, (valueSql: string) => valueSql, 'value');
    }
    return this.coerceToNumber(textExpr, 'value');
  }

  private concatenate(params: SqlExpr[]): SqlExpr {
    // Do not apply formatting when converting to string to match v1 behavior
    // where String(value) is used instead of formatted strings
    const parts = params.map((param) => this.coerceToString(param, false));
    const errorCondition = combineErrorConditions(parts);
    const errorMessage = buildErrorMessageSql(
      parts,
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `CONCAT(${parts.map((p) => p.valueSql).join(', ')})`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private find(params: SqlExpr[]): SqlExpr {
    const searchText = params[0];
    const withinText = params[1];
    const startNum = params[2];
    if (!searchText || !withinText) return makeExpr('NULL', 'number', false);
    const search = this.coerceToString(searchText);
    const within = this.coerceToString(withinText);
    const start = startNum ? this.coerceToNumber(startNum, 'find') : undefined;
    const errorCondition = combineErrorConditions(
      start ? [search, within, start] : [search, within]
    );
    const errorMessage = buildErrorMessageSql(
      start ? [search, within, start] : [search, within],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = start
      ? `POSITION(${search.valueSql} IN SUBSTRING(${within.valueSql} FROM ${start.valueSql}::integer)) + ${start.valueSql}::integer - 1`
      : `POSITION(${search.valueSql} IN ${within.valueSql})`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private search(params: SqlExpr[]): SqlExpr {
    const searchText = params[0];
    const withinText = params[1];
    const startNum = params[2];
    if (!searchText || !withinText) return makeExpr('NULL', 'number', false);
    const search = this.coerceToString(searchText);
    const within = this.coerceToString(withinText);
    const start = startNum ? this.coerceToNumber(startNum, 'search') : undefined;
    const errorCondition = combineErrorConditions(
      start ? [search, within, start] : [search, within]
    );
    const errorMessage = buildErrorMessageSql(
      start ? [search, within, start] : [search, within],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = start
      ? `POSITION(UPPER(${search.valueSql}) IN UPPER(SUBSTRING(${within.valueSql} FROM ${start.valueSql}::integer))) + ${start.valueSql}::integer - 1`
      : `POSITION(UPPER(${search.valueSql}) IN UPPER(${within.valueSql}))`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private mid(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const startNum = params[1];
    const numChars = params[2];
    if (!textExpr || !startNum || !numChars) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const start = this.coerceToNumber(startNum, 'mid');
    const length = this.coerceToNumber(numChars, 'mid');
    const errorCondition = combineErrorConditions([text, start, length]);
    const errorMessage = buildErrorMessageSql(
      [text, start, length],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `SUBSTRING(${text.valueSql} FROM ${start.valueSql}::integer FOR ${length.valueSql}::integer)`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private left(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const numChars = params[1];
    if (!textExpr || !numChars) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const length = this.coerceToNumber(numChars, 'left');
    const errorCondition = combineErrorConditions([text, length]);
    const errorMessage = buildErrorMessageSql(
      [text, length],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `LEFT(${text.valueSql}, ${length.valueSql}::integer)`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private right(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const numChars = params[1];
    if (!textExpr || !numChars) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const length = this.coerceToNumber(numChars, 'right');
    const errorCondition = combineErrorConditions([text, length]);
    const errorMessage = buildErrorMessageSql(
      [text, length],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `RIGHT(${text.valueSql}, ${length.valueSql}::integer)`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private replace(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const startNum = params[1];
    const numChars = params[2];
    const newText = params[3];
    if (!textExpr || !startNum || !numChars || !newText) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const start = this.coerceToNumber(startNum, 'replace');
    const length = this.coerceToNumber(numChars, 'replace');
    const replacement = this.coerceToString(newText);
    const errorCondition = combineErrorConditions([text, start, length, replacement]);
    const errorMessage = buildErrorMessageSql(
      [text, start, length, replacement],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `OVERLAY(${text.valueSql} PLACING ${replacement.valueSql} FROM ${start.valueSql}::integer FOR ${length.valueSql}::integer)`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private regexpReplace(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const pattern = params[1];
    const replacement = params[2];
    if (!textExpr || !pattern || !replacement) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const regex = this.coerceToString(pattern);
    const repl = this.coerceToString(replacement);
    const errorCondition = combineErrorConditions([text, regex, repl]);
    const errorMessage = buildErrorMessageSql(
      [text, regex, repl],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `REGEXP_REPLACE(${text.valueSql}, ${regex.valueSql}, ${repl.valueSql}, 'g')`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private substitute(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const oldText = params[1];
    const newText = params[2];
    if (!textExpr || !oldText || !newText) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const search = this.coerceToString(oldText);
    const replacement = this.coerceToString(newText);
    const errorCondition = combineErrorConditions([text, search, replacement]);
    const errorMessage = buildErrorMessageSql(
      [text, search, replacement],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `REPLACE(${text.valueSql}, ${search.valueSql}, ${replacement.valueSql})`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private lower(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    if (!textExpr) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    return makeExpr(
      guardValueSql(`LOWER(${text.valueSql})`, text.errorConditionSql),
      'string',
      false,
      text.errorConditionSql,
      text.errorMessageSql
    );
  }

  private upper(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    if (!textExpr) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    return makeExpr(
      guardValueSql(`UPPER(${text.valueSql})`, text.errorConditionSql),
      'string',
      false,
      text.errorConditionSql,
      text.errorMessageSql
    );
  }

  private rept(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    const numTimes = params[1];
    if (!textExpr || !numTimes) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    const count = this.coerceToNumber(numTimes, 'rept');
    const errorCondition = combineErrorConditions([text, count]);
    const errorMessage = buildErrorMessageSql(
      [text, count],
      buildErrorLiteral('TYPE', 'cannot_cast_to_text')
    );
    const valueSql = `REPEAT(${text.valueSql}, ${count.valueSql}::integer)`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private trim(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    if (!textExpr) return makeExpr('NULL', 'string', false);
    const text = this.coerceToString(textExpr);
    return makeExpr(
      guardValueSql(`TRIM(${text.valueSql})`, text.errorConditionSql),
      'string',
      false,
      text.errorConditionSql,
      text.errorMessageSql
    );
  }

  private len(params: SqlExpr[]): SqlExpr {
    const textExpr = params[0];
    if (!textExpr) return makeExpr('NULL', 'number', false);
    const text = this.coerceToString(textExpr);
    return makeExpr(
      guardValueSql(`LENGTH(${text.valueSql})`, text.errorConditionSql),
      'number',
      false,
      text.errorConditionSql,
      text.errorMessageSql
    );
  }

  private t(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'string', false);
    if (value.isArray) {
      return makeExpr(
        this.stringifyArrayExpr(value),
        'string',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
    }
    if (value.valueType === 'string') {
      return makeExpr(
        value.valueSql,
        'string',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
    }
    return makeExpr('NULL', 'string', false);
  }

  private encodeUrlComponent(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'string', false);
    // Do not apply formatting when converting to string to match v1 behavior
    const text = this.coerceToString(value, false);
    const textExpr = `(${text.valueSql})::text`;
    const encodedSql = `(SELECT string_agg(
      CASE
        WHEN byte_val BETWEEN 48 AND 57
          OR byte_val BETWEEN 65 AND 90
          OR byte_val BETWEEN 97 AND 122
          OR byte_val IN (45, 95, 46, 33, 126, 42, 39, 40, 41)
        THEN chr(byte_val)
        ELSE '%' || UPPER(LPAD(to_hex(byte_val), 2, '0'))
      END,
      ''
      ORDER BY ord
    )
    FROM (
      SELECT ord, get_byte(src.bytes, ord) AS byte_val
      FROM (SELECT convert_to(${textExpr}, 'UTF8') AS bytes) AS src
      CROSS JOIN generate_series(0, octet_length(src.bytes) - 1) AS ord
    ) AS utf8_bytes)`;
    const valueSql = `(CASE WHEN ${text.valueSql} IS NULL THEN NULL ELSE COALESCE(${encodedSql}, '') END)`;
    return makeExpr(
      guardValueSql(valueSql, text.errorConditionSql),
      'string',
      false,
      text.errorConditionSql,
      text.errorMessageSql
    );
  }

  private ifFunc(params: SqlExpr[]): SqlExpr {
    const condition = params[0];
    const trueExpr = params[1];
    const falseExpr = params[2];
    if (!condition || !trueExpr || !falseExpr) {
      return makeExpr(
        'NULL',
        'string',
        false,
        'TRUE',
        buildErrorLiteral('ARG', 'if_needs_3_params')
      );
    }
    const condBool = this.coerceToBoolean(condition);
    const merged = this.coerceBranches(trueExpr, falseExpr);
    const errorCondition = combineErrorConditions([condBool, merged.left, merged.right]);
    const errorMessage = buildErrorMessageSql(
      [condBool, merged.left, merged.right],
      buildErrorLiteral('TYPE', 'if_branch_mismatch')
    );
    const valueSql = guardValueSql(
      `(CASE WHEN ${condBool.valueSql} THEN ${merged.left.valueSql} ELSE ${merged.right.valueSql} END)`,
      errorCondition
    );
    return makeExpr(valueSql, merged.type, merged.isArray, errorCondition, errorMessage);
  }

  private switchFunc(params: SqlExpr[]): SqlExpr {
    if (params.length < 2) {
      return makeExpr(
        'NULL',
        'string',
        false,
        'TRUE',
        buildErrorLiteral('ARG', 'switch_needs_2_params')
      );
    }
    const expression = params[0];
    const cases = params.slice(1);
    const casePairs: Array<{ match: SqlExpr; result: SqlExpr }> = [];
    for (let i = 0; i < cases.length - 1; i += 2) {
      casePairs.push({ match: cases[i], result: cases[i + 1] });
    }
    const defaultResult = cases.length % 2 === 1 ? cases[cases.length - 1] : undefined;

    const mergedResults = this.coerceSwitchResults(
      casePairs.map((pair) => pair.result),
      defaultResult
    );
    const errorExprs = [
      expression,
      ...casePairs.map((pair) => pair.match),
      ...mergedResults.results,
    ];
    const errorCondition = combineErrorConditions(errorExprs);
    const errorMessage = buildErrorMessageSql(
      errorExprs,
      buildErrorLiteral('TYPE', 'switch_branch_mismatch')
    );

    const normalizedExpression = this.coerceToString(expression);
    const casesSql = casePairs
      .map((pair, index) => {
        const matchText = this.coerceToString(pair.match);
        const resultSql = mergedResults.results[index]?.valueSql ?? pair.result.valueSql;
        return `WHEN ${normalizedExpression.valueSql} = ${matchText.valueSql} THEN ${resultSql}`;
      })
      .join(' ');
    const defaultSql = defaultResult
      ? mergedResults.defaultValueSql ?? defaultResult.valueSql
      : 'NULL';
    const valueSql = guardValueSql(`(CASE ${casesSql} ELSE ${defaultSql} END)`, errorCondition);
    return makeExpr(
      valueSql,
      mergedResults.type,
      mergedResults.isArray,
      errorCondition,
      errorMessage
    );
  }

  private and(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('FALSE', 'boolean', false);
    const boolParams = params.map((param) => this.coerceToBoolean(param));
    const errorCondition = combineErrorConditions(boolParams);
    const errorMessage = buildErrorMessageSql(
      boolParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_boolean')
    );
    const valueSql = guardValueSql(
      `(${boolParams.map((p) => p.valueSql).join(' AND ')})`,
      errorCondition
    );
    return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
  }

  private or(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('FALSE', 'boolean', false);
    const boolParams = params.map((param) => this.coerceToBoolean(param));
    const errorCondition = combineErrorConditions(boolParams);
    const errorMessage = buildErrorMessageSql(
      boolParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_boolean')
    );
    const valueSql = guardValueSql(
      `(${boolParams.map((p) => p.valueSql).join(' OR ')})`,
      errorCondition
    );
    return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
  }

  private not(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'boolean', false);
    const boolExpr = this.coerceToBoolean(value);
    const valueSql = guardValueSql(`(NOT ${boolExpr.valueSql})`, boolExpr.errorConditionSql);
    return makeExpr(
      valueSql,
      'boolean',
      false,
      boolExpr.errorConditionSql,
      boolExpr.errorMessageSql
    );
  }

  private xor(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('FALSE', 'boolean', false);
    const boolParams = params.map((param) => this.coerceToBoolean(param));
    const errorCondition = combineErrorConditions(boolParams);
    const errorMessage = buildErrorMessageSql(
      boolParams,
      buildErrorLiteral('TYPE', 'cannot_cast_to_boolean')
    );
    if (params.length === 1) {
      return makeExpr(boolParams[0].valueSql, 'boolean', false, errorCondition, errorMessage);
    }
    const numericParams = boolParams.map((p) => `(CASE WHEN ${p.valueSql} THEN 1 ELSE 0 END)`);
    const valueSql = guardValueSql(`((${numericParams.join(' + ')}) % 2 = 1)`, errorCondition);
    return makeExpr(valueSql, 'boolean', false, errorCondition, errorMessage);
  }

  private errorFunc(params: SqlExpr[]): SqlExpr {
    const messageExpr = params[0]
      ? this.coerceToString(params[0])
      : makeExpr(sqlStringLiteral(''), 'string', false);
    const prefix = sqlStringLiteral('#ERROR:USER:');
    const emptyLiteral = sqlStringLiteral('');
    const messageSql = `(${prefix} || COALESCE(${messageExpr.valueSql}, ${emptyLiteral}))`;
    const errorMessage = messageExpr.errorConditionSql
      ? `CASE WHEN ${messageExpr.errorConditionSql} THEN ${
          messageExpr.errorMessageSql ?? buildErrorLiteral('INTERNAL', 'error_message_failed')
        } ELSE ${messageSql} END`
      : messageSql;
    return makeExpr('NULL', 'string', false, 'TRUE', errorMessage);
  }

  private isError(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('FALSE', 'boolean', false);
    const textValue = this.coerceToString(value);
    const likeCondition = `(${textValue.valueSql} LIKE ${sqlStringLiteral('#ERROR:%')})`;
    const valueSql = value.errorConditionSql
      ? `(${value.errorConditionSql} OR ${likeCondition})`
      : likeCondition;
    return makeExpr(valueSql, 'boolean', false);
  }

  private applyWeekdayStartDay(weekdaySql: string, startDayOfWeek?: SqlExpr): string {
    if (!startDayOfWeek) {
      return weekdaySql;
    }

    const mondayWeekdaySql = `(((${weekdaySql}) + 6) % 7)`;
    const startDayLiteral = this.getStringLiteralValue(startDayOfWeek)?.trim().toLowerCase();
    if (startDayLiteral) {
      return startDayLiteral === 'monday' ? mondayWeekdaySql : weekdaySql;
    }

    const startDayText = this.coerceToString(startDayOfWeek);
    const normalizedStartDay = `LOWER(BTRIM(${startDayText.valueSql}))`;
    return `(CASE WHEN ${normalizedStartDay} = 'monday' THEN ${mondayWeekdaySql} ELSE ${weekdaySql} END)`;
  }

  private extractDatePart(part: string, params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const startDayOfWeek = part === 'DOW' ? params[1] : undefined;

    // Early check: JSON array object fields (attachment, user) cannot be converted to datetime
    if (value.isArray && this.isJsonArrayObjectField(value)) {
      return makeExpr(
        'NULL::int',
        'number',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_to_datetime'),
        value.field
      );
    }

    if (value.isArray) {
      const normalizedArray = this.normalizeArrayExpr(value);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
      const elementDatetime = this.coerceToDatetime(elemExpr);
      const elementDatePartSql = `EXTRACT(${part} FROM ${this.applyFormulaTimeZone(elementDatetime.valueSql)})::int`;
      const elementValueSql = guardValueSql(
        this.applyWeekdayStartDay(elementDatePartSql, startDayOfWeek),
        elementDatetime.errorConditionSql
      );
      const valueSql = `(SELECT jsonb_agg(to_jsonb(${elementValueSql}) ORDER BY ord)
        FROM jsonb_array_elements(${normalizedArray}) WITH ORDINALITY AS _jae(elem, ord)
      )`;
      return makeExpr(valueSql, 'number', true, value.errorConditionSql, value.errorMessageSql);
    }
    const datetime = this.coerceToDatetime(value);
    const datePartSql = `EXTRACT(${part} FROM ${this.applyFormulaTimeZone(datetime.valueSql)})::int`;
    const valueSql = this.applyWeekdayStartDay(datePartSql, startDayOfWeek);
    return makeExpr(
      guardValueSql(valueSql, datetime.errorConditionSql),
      'number',
      false,
      datetime.errorConditionSql,
      datetime.errorMessageSql
    );
  }

  private buildNowDiffWithUnit(
    datetime: SqlExpr,
    unit: SqlExpr | undefined,
    diffSeconds: string,
    diffMonths: string,
    diffYears: string
  ): SqlExpr {
    if (!unit) {
      return makeExpr(
        guardValueSql(diffSeconds, datetime.errorConditionSql),
        'number',
        false,
        datetime.errorConditionSql,
        datetime.errorMessageSql
      );
    }

    const unitLiteral = this.getStringLiteralValue(unit);
    const normalizedUnit = this.normalizeUnitLiteral(unitLiteral, DATETIME_DIFF_UNIT_ALIASES);
    if (unitLiteral) {
      if (!normalizedUnit) {
        return makeExpr(
          NULL_DOUBLE_PRECISION,
          'number',
          false,
          'TRUE',
          buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
        );
      }
      const valueSql = this.buildDatetimeDiffSql(
        normalizedUnit,
        diffSeconds,
        diffMonths,
        diffYears
      );
      return makeExpr(
        guardValueSql(valueSql, datetime.errorConditionSql),
        'number',
        false,
        datetime.errorConditionSql,
        datetime.errorMessageSql
      );
    }

    if (!this.isUnitStringCompatibleField(unit)) {
      return makeExpr(
        NULL_DOUBLE_PRECISION,
        'number',
        false,
        'TRUE',
        buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
      );
    }

    const unitText = this.coerceToString(unit);
    const unitSql = `LOWER(${unitText.valueSql})`;
    const invalidUnit = `(${unitSql} IS NULL OR ${unitSql} NOT IN (${DATETIME_DIFF_UNIT_SQL}))`;
    const unitErrorExpr = makeExpr(
      'NULL',
      'string',
      false,
      invalidUnit,
      buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
    );
    const errorCondition = combineErrorConditions([datetime, unitText, unitErrorExpr]);
    const errorMessage = buildErrorMessageSql(
      [datetime, unitText, unitErrorExpr],
      buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
    );
    const valueSql = this.buildDatetimeDiffCaseSql(unitSql, diffSeconds, diffMonths, diffYears);
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private fromNow(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const unit = params[1];
    const datetime = this.coerceToDatetime(value);
    const diffSeconds = `EXTRACT(EPOCH FROM (NOW() - ${datetime.valueSql}))`;
    const diffMonths = `EXTRACT(MONTH FROM AGE(NOW(), ${datetime.valueSql})) + EXTRACT(YEAR FROM AGE(NOW(), ${datetime.valueSql})) * 12`;
    const diffYears = `EXTRACT(YEAR FROM AGE(NOW(), ${datetime.valueSql}))`;
    return this.buildNowDiffWithUnit(datetime, unit, diffSeconds, diffMonths, diffYears);
  }

  private toNow(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'number', false);
    const unit = params[1];
    const datetime = this.coerceToDatetime(value);
    const diffSeconds = `EXTRACT(EPOCH FROM (NOW() - ${datetime.valueSql}))`;
    const diffMonths = `EXTRACT(MONTH FROM AGE(NOW(), ${datetime.valueSql})) + EXTRACT(YEAR FROM AGE(NOW(), ${datetime.valueSql})) * 12`;
    const diffYears = `EXTRACT(YEAR FROM AGE(NOW(), ${datetime.valueSql}))`;
    return this.buildNowDiffWithUnit(datetime, unit, diffSeconds, diffMonths, diffYears);
  }

  private datetimeDiff(params: SqlExpr[]): SqlExpr {
    const start = params[0];
    const end = params[1];
    const unit = params[2];
    if (!start || !end || !unit) return makeExpr('NULL', 'number', false);
    const startDt = this.coerceToDatetime(start);
    const endDt = this.coerceToDatetime(end);
    const startError = this.shortCircuitOnError(
      startDt,
      NULL_DOUBLE_PRECISION,
      'number',
      buildErrorLiteral('TYPE', 'invalid_datetime_diff')
    );
    if (startError) return startError;
    const endError = this.shortCircuitOnError(
      endDt,
      NULL_DOUBLE_PRECISION,
      'number',
      buildErrorLiteral('TYPE', 'invalid_datetime_diff')
    );
    if (endError) return endError;
    const diffSeconds = `EXTRACT(EPOCH FROM (${startDt.valueSql} - ${endDt.valueSql}))`;
    const diffMonths = `EXTRACT(MONTH FROM AGE(${endDt.valueSql}, ${startDt.valueSql})) + EXTRACT(YEAR FROM AGE(${endDt.valueSql}, ${startDt.valueSql})) * 12`;
    const diffYears = `EXTRACT(YEAR FROM AGE(${endDt.valueSql}, ${startDt.valueSql}))`;
    const unitLiteral = this.getStringLiteralValue(unit);
    const normalizedUnit = this.normalizeUnitLiteral(unitLiteral, DATETIME_DIFF_UNIT_ALIASES);
    if (unitLiteral) {
      if (!normalizedUnit) {
        return makeExpr(
          NULL_DOUBLE_PRECISION,
          'number',
          false,
          'TRUE',
          buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
        );
      }
      const errorCondition = combineErrorConditions([startDt, endDt]);
      const errorMessage = buildErrorMessageSql(
        [startDt, endDt],
        buildErrorLiteral('TYPE', 'invalid_datetime_diff')
      );
      const valueSql = this.buildDatetimeDiffSql(
        normalizedUnit,
        diffSeconds,
        diffMonths,
        diffYears
      );
      return makeExpr(
        guardValueSql(valueSql, errorCondition),
        'number',
        false,
        errorCondition,
        errorMessage
      );
    }

    // 编译期检查：如果单位参数是字段引用且类型不兼容，直接返回错误
    if (!this.isUnitStringCompatibleField(unit)) {
      return makeExpr(
        NULL_DOUBLE_PRECISION,
        'number',
        false,
        'TRUE',
        buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
      );
    }

    const unitText = this.coerceToString(unit);
    const unitSql = `LOWER(${unitText.valueSql})`;
    const invalidUnit = `(${unitSql} IS NULL OR ${unitSql} NOT IN (${DATETIME_DIFF_UNIT_SQL}))`;
    const unitErrorExpr = makeExpr(
      'NULL',
      'string',
      false,
      invalidUnit,
      buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
    );
    const errorCondition = combineErrorConditions([startDt, endDt, unitText, unitErrorExpr]);
    const errorMessage = buildErrorMessageSql(
      [startDt, endDt, unitText, unitErrorExpr],
      buildErrorLiteral('ARG', 'invalid_datetime_diff_unit')
    );
    const valueSql = this.buildDatetimeDiffCaseSql(unitSql, diffSeconds, diffMonths, diffYears);
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private workday(params: SqlExpr[]): SqlExpr {
    const start = params[0];
    const days = params[1];
    if (!start || !days) return makeExpr('NULL', 'datetime', false);
    const startDt = this.coerceToDatetime(start);
    const dayCount = this.coerceToNumber(days, 'workday');
    const errorCondition = combineErrorConditions([startDt, dayCount]);
    const errorMessage = buildErrorMessageSql(
      [startDt, dayCount],
      buildErrorLiteral('TYPE', 'invalid_workday')
    );
    const valueSql = `(${this.applyFormulaTimeZone(
      startDt.valueSql
    )})::date + INTERVAL '1 day' * ${dayCount.valueSql}`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'datetime',
      false,
      errorCondition,
      errorMessage
    );
  }

  private workdayDiff(params: SqlExpr[]): SqlExpr {
    const start = params[0];
    const end = params[1];
    if (!start || !end) return makeExpr('NULL::double precision', 'number', false);

    // Match v1 behavior: if either operand is a numeric type (not datetime),
    // return NULL instead of attempting to convert numeric values to timestamps.
    // This prevents treating numeric values like 8 or 12 as Unix timestamps.
    const startIsNumericType = start.valueType === 'number';
    const endIsNumericType = end.valueType === 'number';

    if (startIsNumericType || endIsNumericType) {
      return makeExpr('NULL::double precision', 'number', false);
    }

    const startDt = this.coerceToDatetime(start);
    const endDt = this.coerceToDatetime(end);
    const errorCondition = combineErrorConditions([startDt, endDt]);
    const errorMessage = buildErrorMessageSql(
      [startDt, endDt],
      buildErrorLiteral('TYPE', 'invalid_workday_diff')
    );
    const valueSql = `(${this.applyFormulaTimeZone(
      endDt.valueSql
    )})::date - (${this.applyFormulaTimeZone(startDt.valueSql)})::date`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'number',
      false,
      errorCondition,
      errorMessage
    );
  }

  private isSame(params: SqlExpr[]): SqlExpr {
    const left = params[0];
    const right = params[1];
    const unit = params[2];
    if (!left || !right) return makeExpr('FALSE', 'boolean', false);
    const leftDt = this.coerceToDatetime(left);
    const rightDt = this.coerceToDatetime(right);
    const leftError = this.shortCircuitOnError(
      leftDt,
      NULL_BOOLEAN,
      'boolean',
      buildErrorLiteral('TYPE', 'invalid_is_same')
    );
    if (leftError) return leftError;
    const rightError = this.shortCircuitOnError(
      rightDt,
      NULL_BOOLEAN,
      'boolean',
      buildErrorLiteral('TYPE', 'invalid_is_same')
    );
    if (rightError) return rightError;
    if (!unit) {
      const errorCondition = combineErrorConditions([leftDt, rightDt]);
      const errorMessage = buildErrorMessageSql(
        [leftDt, rightDt],
        buildErrorLiteral('TYPE', 'invalid_is_same')
      );
      const valueSql = `${leftDt.valueSql} = ${rightDt.valueSql}`;
      return makeExpr(
        guardValueSql(valueSql, errorCondition),
        'boolean',
        false,
        errorCondition,
        errorMessage
      );
    }

    const unitLiteral = this.getStringLiteralValue(unit);
    const normalizedUnit = this.normalizeUnitLiteral(unitLiteral, IS_SAME_UNIT_ALIASES);
    if (unitLiteral) {
      if (!normalizedUnit) {
        return makeExpr(
          NULL_BOOLEAN,
          'boolean',
          false,
          'TRUE',
          buildErrorLiteral('ARG', 'invalid_is_same_unit')
        );
      }
      const errorCondition = combineErrorConditions([leftDt, rightDt]);
      const errorMessage = buildErrorMessageSql(
        [leftDt, rightDt],
        buildErrorLiteral('TYPE', 'invalid_is_same')
      );
      const valueSql = this.buildIsSameSql(normalizedUnit, leftDt.valueSql, rightDt.valueSql);
      return makeExpr(
        guardValueSql(valueSql, errorCondition),
        'boolean',
        false,
        errorCondition,
        errorMessage
      );
    }

    // 编译期检查：如果单位参数是字段引用且类型不兼容，直接返回错误
    if (!this.isUnitStringCompatibleField(unit)) {
      return makeExpr(
        NULL_BOOLEAN,
        'boolean',
        false,
        'TRUE',
        buildErrorLiteral('ARG', 'invalid_is_same_unit')
      );
    }

    const unitText = this.coerceToString(unit);
    const unitSql = `LOWER(${unitText.valueSql})`;
    const invalidUnit = `(${unitSql} IS NULL OR ${unitSql} NOT IN (${IS_SAME_UNIT_SQL}))`;
    const unitErrorExpr = makeExpr(
      'NULL',
      'string',
      false,
      invalidUnit,
      buildErrorLiteral('ARG', 'invalid_is_same_unit')
    );
    const errorCondition = combineErrorConditions([leftDt, rightDt, unitText, unitErrorExpr]);
    const errorMessage = buildErrorMessageSql(
      [leftDt, rightDt, unitText, unitErrorExpr],
      buildErrorLiteral('ARG', 'invalid_is_same_unit')
    );
    const valueSql = this.buildIsSameCaseSql(unitSql, leftDt.valueSql, rightDt.valueSql);
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'boolean',
      false,
      errorCondition,
      errorMessage
    );
  }

  private isAfter(params: SqlExpr[]): SqlExpr {
    const left = params[0];
    const right = params[1];
    if (!left || !right) return makeExpr('FALSE', 'boolean', false);
    return this.handleComparison('>', left, right);
  }

  private isBefore(params: SqlExpr[]): SqlExpr {
    const left = params[0];
    const right = params[1];
    if (!left || !right) return makeExpr('FALSE', 'boolean', false);
    return this.handleComparison('<', left, right);
  }

  private dateAdd(params: SqlExpr[]): SqlExpr {
    const dateExpr = params[0];
    const countExpr = params[1];
    const unitExpr = params[2];
    if (!dateExpr || !countExpr || !unitExpr) return makeExpr('NULL', 'datetime', false);
    const dateValue = this.coerceToDatetime(dateExpr);
    const countValue = this.coerceToNumber(countExpr, 'date_add');
    const dateError = this.shortCircuitOnError(
      dateValue,
      NULL_TIMESTAMPTZ,
      'datetime',
      buildErrorLiteral('TYPE', 'invalid_date_add')
    );
    if (dateError) return dateError;
    const countError = this.shortCircuitOnError(
      countValue,
      NULL_TIMESTAMPTZ,
      'datetime',
      buildErrorLiteral('TYPE', 'invalid_date_add')
    );
    if (countError) return countError;
    const unitLiteral = this.getStringLiteralValue(unitExpr);
    const normalizedUnit = this.normalizeUnitLiteral(unitLiteral, DATE_ADD_UNIT_ALIASES);
    if (unitLiteral) {
      if (!normalizedUnit) {
        return makeExpr(
          NULL_TIMESTAMPTZ,
          'datetime',
          false,
          'TRUE',
          buildErrorLiteral('ARG', 'invalid_date_add_unit')
        );
      }
      const errorCondition = combineErrorConditions([dateValue, countValue]);
      const errorMessage = buildErrorMessageSql(
        [dateValue, countValue],
        buildErrorLiteral('TYPE', 'invalid_date_add')
      );
      const valueSql = this.buildDateAddSql(
        normalizedUnit,
        dateValue.valueSql,
        countValue.valueSql
      );
      return makeExpr(
        guardValueSql(valueSql, errorCondition),
        'datetime',
        false,
        errorCondition,
        errorMessage
      );
    }

    // 编译期检查：如果单位参数是字段引用且类型不兼容，直接返回错误
    if (!this.isUnitStringCompatibleField(unitExpr)) {
      return makeExpr(
        NULL_TIMESTAMPTZ,
        'datetime',
        false,
        'TRUE',
        buildErrorLiteral('ARG', 'invalid_date_add_unit')
      );
    }

    const unitValue = this.coerceToString(unitExpr);
    const unitSql = `LOWER(${unitValue.valueSql})`;
    const invalidUnit = `(${unitSql} IS NULL OR ${unitSql} NOT IN (${DATE_ADD_UNIT_SQL}))`;
    const unitErrorExpr = makeExpr(
      'NULL',
      'string',
      false,
      invalidUnit,
      buildErrorLiteral('ARG', 'invalid_date_add_unit')
    );
    const errorCondition = combineErrorConditions([
      dateValue,
      countValue,
      unitValue,
      unitErrorExpr,
    ]);
    const errorMessage = buildErrorMessageSql(
      [dateValue, countValue, unitValue, unitErrorExpr],
      buildErrorLiteral('ARG', 'invalid_date_add_unit')
    );
    const valueSql = this.buildDateAddCaseSql(unitSql, dateValue.valueSql, countValue.valueSql);
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'datetime',
      false,
      errorCondition,
      errorMessage
    );
  }

  private datestr(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'string', false);
    if (value.isArray) {
      const normalizedArray = this.normalizeArrayExpr(value);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
      const elementDatetime = this.coerceToDatetime(elemExpr);
      const elementValueSql = guardValueSql(
        `(${this.applyFormulaTimeZone(elementDatetime.valueSql)})::date::text`,
        elementDatetime.errorConditionSql
      );
      const valueSql = this.stringifyNormalizedJsonArrayWithElement(
        normalizedArray,
        elementValueSql
      );
      return makeExpr(
        guardValueSql(valueSql, value.errorConditionSql),
        'string',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
    }
    const datetime = this.coerceToDatetime(value);
    const valueSql = `(${this.applyFormulaTimeZone(datetime.valueSql)})::date::text`;
    return makeExpr(
      guardValueSql(valueSql, datetime.errorConditionSql),
      'string',
      false,
      datetime.errorConditionSql,
      datetime.errorMessageSql
    );
  }

  private timestr(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'string', false);
    if (value.isArray) {
      const normalizedArray = this.normalizeArrayExpr(value);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
      const elementDatetime = this.coerceToDatetime(elemExpr);
      const elementValueSql = guardValueSql(
        `(${this.applyFormulaTimeZone(elementDatetime.valueSql)})::time::text`,
        elementDatetime.errorConditionSql
      );
      const valueSql = this.stringifyNormalizedJsonArrayWithElement(
        normalizedArray,
        elementValueSql
      );
      return makeExpr(
        guardValueSql(valueSql, value.errorConditionSql),
        'string',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
    }
    const datetime = this.coerceToDatetime(value);
    const valueSql = `(${this.applyFormulaTimeZone(datetime.valueSql)})::time::text`;
    return makeExpr(
      guardValueSql(valueSql, datetime.errorConditionSql),
      'string',
      false,
      datetime.errorConditionSql,
      datetime.errorMessageSql
    );
  }

  private datetimeFormat(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    const format = params[1];
    if (!value) return makeExpr('NULL', 'string', false);

    if (value.isArray) {
      let formatText: SqlExpr | undefined;
      let formatExprSql: string | null = null;
      if (!format) {
        formatExprSql = null;
      } else {
        formatText = this.coerceToString(format);
        const formatLiteral = this.getStringLiteralValue(formatText);
        formatExprSql =
          formatLiteral !== undefined ? sqlStringLiteral(formatLiteral) : formatText.valueSql;
      }

      const normalizedArray = this.normalizeArrayExpr(value);
      const elemExpr = makeExpr(
        extractJsonScalarText('elem'),
        'unknown',
        false,
        value.errorConditionSql,
        value.errorMessageSql
      );
      const elementDatetime = this.coerceToDatetime(elemExpr);
      const localTimestampSql = this.applyFormulaTimeZone(elementDatetime.valueSql);
      const elementValueSql = guardValueSql(
        buildDatetimeFormatSql(
          localTimestampSql,
          formatExprSql,
          this.buildTimezoneOffsetSql(localTimestampSql)
        ),
        elementDatetime.errorConditionSql
      );
      const valueSql = this.stringifyNormalizedJsonArrayWithElement(
        normalizedArray,
        elementValueSql
      );
      const errorCondition = combineErrorConditions(formatText ? [value, formatText] : [value]);
      const errorMessage = buildErrorMessageSql(
        formatText ? [value, formatText] : [value],
        buildErrorLiteral('TYPE', 'invalid_datetime_format')
      );
      return makeExpr(
        guardValueSql(valueSql, errorCondition),
        'string',
        false,
        errorCondition,
        errorMessage
      );
    }

    const datetime = this.coerceToDatetime(value);
    const localTimestampSql = this.applyFormulaTimeZone(datetime.valueSql);
    const formatText = format ? this.coerceToString(format) : undefined;
    const formatLiteral = formatText ? this.getStringLiteralValue(formatText) : undefined;
    const formatExprSql = formatText
      ? formatLiteral !== undefined
        ? sqlStringLiteral(formatLiteral)
        : formatText.valueSql
      : null;

    const errorCondition = combineErrorConditions(formatText ? [datetime, formatText] : [datetime]);
    const errorMessage = buildErrorMessageSql(
      formatText ? [datetime, formatText] : [datetime],
      buildErrorLiteral('TYPE', 'invalid_datetime_format')
    );
    const valueSql = buildDatetimeFormatSql(
      localTimestampSql,
      formatExprSql,
      this.buildTimezoneOffsetSql(localTimestampSql)
    );

    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private buildTimezoneOffsetSql(localTimestampSql: string): string {
    const offsetMinutesSql = `ROUND(EXTRACT(EPOCH FROM (((${localTimestampSql}) AT TIME ZONE 'UTC') - ((${localTimestampSql}) AT TIME ZONE ${this.formulaTimeZoneSql()}))) / 60)::int`;

    return `(CASE WHEN ${offsetMinutesSql} >= 0 THEN '+' ELSE '-' END || LPAD((ABS(${offsetMinutesSql}) / 60)::int::text, 2, '0') || ':' || LPAD((ABS(${offsetMinutesSql}) % 60)::int::text, 2, '0'))`;
  }

  private datetimeParse(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'datetime', false);
    if (!value.isArray && value.valueType === 'datetime' && !this.isStructuredJsonField(value)) {
      return this.coerceToDatetime(value);
    }
    // 编译期检查：如果字段类型不兼容，直接返回错误
    if (!this.canFieldBeDatetimeString(value)) {
      return makeExpr(
        'NULL::timestamptz',
        'datetime',
        false,
        'TRUE',
        buildErrorLiteral('TYPE', 'cannot_cast_to_datetime'),
        value.field
      );
    }
    const textValue = this.coerceToString(value);
    const textSql = `${textValue.valueSql}::text`;
    const validTimestamptz = this.typeValidation.isValidForType(textSql, 'timestamptz');
    const validTimestamp = this.typeValidation.isValidForType(textSql, 'timestamp');
    const valueSql = `(CASE
      WHEN ${textValue.valueSql} IS NULL THEN NULL
      WHEN ${validTimestamptz} THEN (${textValue.valueSql})::timestamptz
      WHEN ${validTimestamp} THEN ${this.interpretTimestampInFormulaTimeZone(textSql)}
      ELSE NULL
    END)`;
    const errorCondition = `(${textValue.valueSql} IS NOT NULL AND NOT (${validTimestamptz} OR ${validTimestamp}))`;
    const combinedErrorCondition = combineErrorConditions([
      textValue,
      makeExpr(
        'NULL',
        'datetime',
        false,
        errorCondition,
        buildErrorLiteral('TYPE', 'cannot_cast_to_datetime')
      ),
    ]);
    const errorMessage = buildErrorMessageSql(
      [
        textValue,
        makeExpr(
          'NULL',
          'datetime',
          false,
          errorCondition,
          buildErrorLiteral('TYPE', 'cannot_cast_to_datetime')
        ),
      ],
      buildErrorLiteral('TYPE', 'cannot_cast_to_datetime')
    );
    return makeExpr(
      guardValueSql(valueSql, combinedErrorCondition),
      'datetime',
      false,
      combinedErrorCondition,
      errorMessage
    );
  }

  private setLocale(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr(NULL_TIMESTAMPTZ, 'datetime', false);
    // Locale is a formatting concern; SQL translation keeps the datetime unchanged.
    return this.coerceToDatetime(value);
  }

  private setTimezone(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    const timeZone = params[1];
    if (!value || !timeZone) return makeExpr(NULL_TIMESTAMPTZ, 'datetime', false);
    const datetime = this.coerceToDatetime(value);
    const timeZoneText = this.coerceToString(timeZone);
    const errorCondition = combineErrorConditions([datetime, timeZoneText]);
    const errorMessage = buildErrorMessageSql(
      [datetime, timeZoneText],
      buildErrorLiteral('TYPE', 'invalid_timezone')
    );
    // Convert to the timezone's local time, then re-tag as UTC so downstream operations
    // (DATETIME_FORMAT, YEAR, etc.) operate in the requested timezone.
    const localizedSql = `((${datetime.valueSql} AT TIME ZONE ${timeZoneText.valueSql}) AT TIME ZONE 'UTC')`;
    const valueSql = guardValueSql(localizedSql, errorCondition);
    return makeExpr(valueSql, 'datetime', false, errorCondition, errorMessage);
  }

  private quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private recordSystemColumn(column: string): string {
    const alias = this.quoteIdentifier(this.translator.tableAlias);
    return `${alias}.${this.quoteIdentifier(column)}`;
  }

  private createdTime(_params: SqlExpr[]): SqlExpr {
    return makeExpr(this.recordSystemColumn('__created_time'), 'datetime', false);
  }

  private lastModifiedTime(_params: SqlExpr[]): SqlExpr {
    return makeExpr(this.recordSystemColumn('__last_modified_time'), 'datetime', false);
  }

  private count(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('0', 'number', false);
    const errorCondition = combineErrorConditions(params);
    const errorMessage = buildErrorMessageSql(params, buildErrorLiteral('TYPE', 'count_invalid'));
    const terms = params.map((param) => {
      if (param.isArray) {
        const normalized = this.normalizeArrayExpr(param);
        return `(
          SELECT COUNT(*)
          FROM jsonb_array_elements(${normalized}) AS elem
          WHERE elem IS NOT NULL AND elem <> 'null'::jsonb
        )`;
      }
      return `CASE WHEN ${param.valueSql} IS NOT NULL THEN 1 ELSE 0 END`;
    });
    const valueSql = guardValueSql(`(${terms.join(' + ')})`, errorCondition);
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private countA(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('0', 'number', false);
    const errorCondition = combineErrorConditions(params);
    const errorMessage = buildErrorMessageSql(params, buildErrorLiteral('TYPE', 'count_invalid'));
    const terms = params.map((param) => {
      if (param.isArray) {
        const normalized = this.normalizeArrayExpr(param);
        return `(
          SELECT COUNT(*)
          FROM jsonb_array_elements(${normalized}) AS elem
          WHERE elem IS NOT NULL AND elem <> 'null'::jsonb AND (${extractJsonScalarText('elem')}) <> ''
        )`;
      }
      return `CASE WHEN ${param.valueSql} IS NULL OR (${param.valueSql})::text = '' THEN 0 ELSE 1 END`;
    });
    const valueSql = guardValueSql(`(${terms.join(' + ')})`, errorCondition);
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private countAll(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('0', 'number', false);
    const value = params[0];
    const errorCondition = value ? combineErrorConditions([value]) : undefined;
    const errorMessage = value
      ? buildErrorMessageSql([value], buildErrorLiteral('TYPE', 'count_invalid'))
      : undefined;
    if (value?.isArray) {
      const normalized = this.normalizeArrayExpr(value);
      const valueSql = guardValueSql(
        `COALESCE(jsonb_array_length(${normalized}), 0)`,
        errorCondition
      );
      return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
    }
    const valueSql = guardValueSql(
      `CASE WHEN ${value?.valueSql ?? 'NULL'} IS NULL THEN 0 ELSE 1 END`,
      errorCondition
    );
    return makeExpr(valueSql, 'number', false, errorCondition, errorMessage);
  }

  private arrayJoin(params: SqlExpr[]): SqlExpr {
    const arrayExpr = params[0];
    if (!arrayExpr) return makeExpr('NULL', 'string', false);
    const separator = params[1]
      ? this.coerceToString(params[1])
      : makeExpr(sqlStringLiteral(', '), 'string', false);
    const errorCondition = combineErrorConditions([arrayExpr, separator]);
    const errorMessage = buildErrorMessageSql(
      [arrayExpr, separator],
      buildErrorLiteral('TYPE', 'array_join_invalid')
    );
    const normalized = this.normalizeArrayExpr(arrayExpr);
    const valueSql = `(
      SELECT string_agg(${extractJsonScalarText('elem')}, ${separator.valueSql})
      FROM jsonb_array_elements(${normalized}) AS elem
    )`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      false,
      errorCondition,
      errorMessage
    );
  }

  private arrayUnique(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('[]', 'string', true);
    const errorCondition = combineErrorConditions(params);
    const errorMessage = buildErrorMessageSql(
      params,
      buildErrorLiteral('TYPE', 'array_unique_invalid')
    );
    const arrays = params.map((param) => this.normalizeArrayExpr(param));
    const unionQuery = arrays
      .map(
        (array, index) => `SELECT elem.value, ${index} AS arg_index, ord
          FROM jsonb_array_elements_text(${array}) WITH ORDINALITY AS elem(value, ord)`
      )
      .join(' UNION ALL ');
    const valueSql = `(
      SELECT jsonb_agg(value)
      FROM (
        SELECT DISTINCT ON (value) value
        FROM (${unionQuery}) AS combined(value, arg_index, ord)
        ORDER BY value, arg_index, ord
      ) AS uniq
    )`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      true,
      errorCondition,
      errorMessage
    );
  }

  private arrayFlatten(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('[]', 'string', true);
    const errorCondition = combineErrorConditions(params);
    const errorMessage = buildErrorMessageSql(
      params,
      buildErrorLiteral('TYPE', 'array_flatten_invalid')
    );
    const arrays = params.map((param) => this.normalizeArrayExpr(param));
    const unionQuery = arrays
      .map(
        (array, index) => `SELECT elem.value, ${index} AS arg_index, ord
          FROM jsonb_array_elements_text(${array}) WITH ORDINALITY AS elem(value, ord)`
      )
      .join(' UNION ALL ');
    const valueSql = `(
      SELECT jsonb_agg(value)
      FROM (
        SELECT value
        FROM (${unionQuery}) AS combined(value, arg_index, ord)
        ORDER BY arg_index, ord
      ) AS flat
    )`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      true,
      errorCondition,
      errorMessage
    );
  }

  private arrayCompact(params: SqlExpr[]): SqlExpr {
    if (params.length === 0) return makeExpr('[]', 'string', true);
    const errorCondition = combineErrorConditions(params);
    const errorMessage = buildErrorMessageSql(
      params,
      buildErrorLiteral('TYPE', 'array_compact_invalid')
    );
    const arrays = params.map((param) => this.normalizeArrayExpr(param));
    const unionQuery = arrays
      .map(
        (array, index) => `SELECT elem.value, ${index} AS arg_index, ord
          FROM jsonb_array_elements_text(${array}) WITH ORDINALITY AS elem(value, ord)
          WHERE elem.value IS NOT NULL AND elem.value != ''`
      )
      .join(' UNION ALL ');
    const valueSql = `(
      SELECT jsonb_agg(value)
      FROM (
        SELECT value
        FROM (${unionQuery}) AS combined(value, arg_index, ord)
        ORDER BY arg_index, ord
      ) AS compacted
    )`;
    return makeExpr(
      guardValueSql(valueSql, errorCondition),
      'string',
      true,
      errorCondition,
      errorMessage
    );
  }

  private textAll(params: SqlExpr[]): SqlExpr {
    const value = params[0];
    if (!value) return makeExpr('NULL', 'string', false);
    return this.coerceToString(value);
  }
}
