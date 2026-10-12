/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
export const DEFAULT_DATETIME_FORMAT_EXPR = "'YYYY-MM-DD'";

export const DEFAULT_DATETIME_FORMAT_LITERAL = 'YYYY-MM-DD';

export const LOCALIZED_DATETIME_FORMAT_MAP = {
  LT: 'h:mm A',
  LTS: 'h:mm:ss A',
  L: 'MM/DD/YYYY',
  LL: 'MMMM D, YYYY',
  LLL: 'MMMM D, YYYY h:mm A',
  LLLL: 'dddd, MMMM D, YYYY h:mm A',
  l: 'M/D/YYYY',
  ll: 'MMM D, YYYY',
  lll: 'MMM D, YYYY h:mm A',
  llll: 'ddd, MMM D, YYYY h:mm A',
} as const;

export type ILocalizedDatetimeFormatToken = keyof typeof LOCALIZED_DATETIME_FORMAT_MAP;

export interface IDatetimeFormatWriter {
  sql(parts: TemplateStringsArray, ...values: ReadonlyArray<unknown>): string;
  join(values: ReadonlyArray<string>, separator: string): string;
  bytes(value: string): number;
  allocate(bytes: number): void;
}

const unmeteredSql = (parts: TemplateStringsArray, ...values: ReadonlyArray<unknown>): string => {
  let result = parts[0];
  for (let i = 0; i < values.length; i++) result += String(values[i]) + parts[i + 1];
  return result;
};

type IDatetimeFormatSqlBuilder = (
  datetimeSql: string,
  timezoneOffsetSql: string,
  writer?: IDatetimeFormatWriter
) => string;

export const DATETIME_FORMAT_SQL_BUILDERS = {
  HH24: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'HH24')`,
  HH12: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'HH12')`,
  MI: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'MI')`,
  MS: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'MS')`,
  SS: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'SS')`,
  Month: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMMonth')`,
  MONTH: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMMONTH')`,
  month: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMmonth')`,
  Day: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMDay')`,
  DAY: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMDAY')`,
  day: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMday')`,
  YYYY: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'YYYY')`,
  MMMM: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMMonth')`,
  dddd: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMDay')`,
  ddd: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMDy')`,
  dd: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`LEFT(TO_CHAR(${valueSql}, 'FMDy'), 2)`,
  d: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`EXTRACT(DOW FROM ${valueSql})::int::text`,
  MMM: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMMon')`,
  YY: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'YY')`,
  MM: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'MM')`,
  M: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMMM')`,
  DD: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'DD')`,
  D: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMDD')`,
  HH: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'HH24')`,
  H: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMHH24')`,
  hh: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'HH12')`,
  h: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMHH12')`,
  mm: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'MI')`,
  m: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMMI')`,
  ss: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'SS')`,
  s: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'FMSS')`,
  SSS: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'MS')`,
  ZZ: (_valueSql, timezoneOffsetSql, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`REPLACE(${timezoneOffsetSql}, ':', '')`,
  Z: (_valueSql, timezoneOffsetSql, _writer?: IDatetimeFormatWriter) => timezoneOffsetSql,
  A: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`TO_CHAR(${valueSql}, 'AM')`,
  a: (valueSql, _offset?: string, writer?: IDatetimeFormatWriter) =>
    (writer?.sql ?? unmeteredSql)`LOWER(TO_CHAR(${valueSql}, 'AM'))`,
} as const satisfies Record<string, IDatetimeFormatSqlBuilder>;

export type ISupportedDatetimeFormatToken = keyof typeof DATETIME_FORMAT_SQL_BUILDERS;

export const DATETIME_FORMAT_TOKEN_TO_POSTGRES = {
  HH24: 'HH24',
  HH12: 'HH12',
  MI: 'MI',
  MS: 'MS',
  SS: 'SS',
  Month: 'FMMonth',
  MONTH: 'FMMONTH',
  month: 'FMmonth',
  Day: 'FMDay',
  DAY: 'FMDAY',
  day: 'FMday',
  dddd: 'FMDay',
  ddd: 'FMDy',
  dd: 'FMDy',
  d: 'D',
  YYYY: 'YYYY',
  YY: 'YY',
  MMMM: 'FMMonth',
  MMM: 'FMMon',
  MM: 'MM',
  M: 'FMMM',
  DD: 'DD',
  D: 'FMDD',
  HH: 'HH24',
  H: 'FMHH24',
  hh: 'HH12',
  h: 'FMHH12',
  mm: 'MI',
  m: 'FMMI',
  ss: 'SS',
  s: 'FMSS',
  SSS: 'MS',
  Z: 'OF',
  ZZ: 'OF',
  A: 'AM',
  a: 'am',
} as const satisfies Record<ISupportedDatetimeFormatToken, string>;

const sortedLocalizedDatetimeFormatTokens = (
  Object.keys(LOCALIZED_DATETIME_FORMAT_MAP) as ILocalizedDatetimeFormatToken[]
).sort((a, b) => b.length - a.length);

const sortedSupportedDatetimeFormatTokens = (
  Object.keys(DATETIME_FORMAT_SQL_BUILDERS) as ISupportedDatetimeFormatToken[]
).sort((a, b) => b.length - a.length);

const timezoneFormatTokens = new Set<ISupportedDatetimeFormatToken>(['Z', 'ZZ']);

const DATETIME_PARSE_GUARD_TOKEN_PATTERNS = {
  HH24: '\\d{2}',
  HH12: '\\d{2}',
  HH: '\\d{2}',
  AM: '[AaPp][Mm]',
  MI: '\\d{2}',
  SS: '\\d{2}',
  MS: '\\d{1,3}',
  YYYY: '\\d{4}',
  YYY: '\\d{3}',
  YY: '\\d{2}',
  Y: '\\d',
  MM: '\\d{2}',
  DD: '\\d{2}',
} as const;

type IGuardableDatetimeToken = keyof typeof DATETIME_PARSE_GUARD_TOKEN_PATTERNS;

const optionalDatetimeParseGuardTokens = new Set(['FM', 'TM', 'TH']);

const DEFAULT_TIMEZONE_OFFSET_SQL = "'+00:00'";

const toSqlStringLiteral = (literal: string, writer?: IDatetimeFormatWriter): string => {
  if (writer) {
    let quotes = 0;
    for (const char of literal) if (char === "'") quotes++;
    writer.allocate(writer.bytes(literal) + quotes);
  }
  const escaped = literal.replaceAll("'", "''");
  return (writer?.sql ?? unmeteredSql)`'${escaped}'`;
};

const parseSqlStringLiteral = (expr: string): string | null => {
  const trimmed = expr.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    return null;
  }

  return trimmed.slice(1, -1).replaceAll("''", "'");
};

const shouldMatchSingleCharToken = (literal: string, index: number): boolean => {
  const prevChar = index > 0 ? literal[index - 1] : '';
  const nextChar = index + 1 < literal.length ? literal[index + 1] : '';
  const prevIsAlpha = /[A-Z]/i.test(prevChar);
  const nextIsAlpha = /[A-Z]/i.test(nextChar);
  return !prevIsAlpha && !nextIsAlpha;
};

export const expandLocalizedDatetimeFormat = (
  literal: string,
  writer?: IDatetimeFormatWriter
): string => {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < literal.length; ) {
    const token = sortedLocalizedDatetimeFormatTokens.find((candidate) =>
      literal.startsWith(candidate, i)
    );
    if (token && (token.length !== 1 || shouldMatchSingleCharToken(literal, i))) {
      parts.push(literal.slice(start, i), LOCALIZED_DATETIME_FORMAT_MAP[token]);
      i += token.length;
      start = i;
    } else {
      i++;
    }
  }
  if (start === 0) return literal;
  parts.push(literal.slice(start));
  return writer ? writer.join(parts, '') : parts.join('');
};

const forEachSupportedDatetimeFormatToken = (
  literal: string,
  options: {
    onToken: (token: ISupportedDatetimeFormatToken) => void;
    onLiteralChar: (char: string) => void;
  },
  writer?: IDatetimeFormatWriter
) => {
  const expandedLiteral = expandLocalizedDatetimeFormat(literal, writer);

  for (let i = 0; i < expandedLiteral.length; ) {
    const token = sortedSupportedDatetimeFormatTokens.find((candidate) =>
      expandedLiteral.startsWith(candidate, i)
    );

    if (token) {
      if (token.length === 1 && !shouldMatchSingleCharToken(expandedLiteral, i)) {
        options.onLiteralChar(expandedLiteral[i]);
        i += 1;
        continue;
      }

      options.onToken(token);
      i += token.length;
      continue;
    }

    const width = (expandedLiteral.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    options.onLiteralChar(expandedLiteral.slice(i, i + width));
    i += width;
  }
};

const buildDatetimeFormatSqlFromLiteral = (
  datetimeSql: string,
  formatLiteral: string,
  timezoneOffsetSql: string,
  writer?: IDatetimeFormatWriter
): string => {
  const sqlParts: string[] = [];
  const literalParts: string[] = [];

  const flushLiteral = () => {
    if (!literalParts.length) {
      return;
    }

    const literal = writer ? writer.join(literalParts, '') : literalParts.join('');
    sqlParts.push(toSqlStringLiteral(literal, writer));
    literalParts.length = 0;
  };

  forEachSupportedDatetimeFormatToken(
    formatLiteral,
    {
      onToken: (token) => {
        flushLiteral();
        sqlParts.push(DATETIME_FORMAT_SQL_BUILDERS[token](datetimeSql, timezoneOffsetSql, writer));
      },
      onLiteralChar: (char) => {
        literalParts.push(char);
      },
    },
    writer
  );

  flushLiteral();

  if (!sqlParts.length) {
    return "''";
  }

  return writer ? writer.join(sqlParts, ' || ') : sqlParts.join(' || ');
};

const resolveFormatLiteral = (formatExpr?: string | null): string | null => {
  if (typeof formatExpr !== 'string') {
    return DEFAULT_DATETIME_FORMAT_LITERAL;
  }

  const trimmed = formatExpr.trim();
  if (!trimmed) {
    return DEFAULT_DATETIME_FORMAT_LITERAL;
  }

  return parseSqlStringLiteral(trimmed);
};

const normalizeDatetimeFormatLiteral = (
  literal: string,
  writer?: IDatetimeFormatWriter
): string => {
  const parts: string[] = [];

  forEachSupportedDatetimeFormatToken(
    literal,
    {
      onToken: (token) => {
        parts.push(DATETIME_FORMAT_TOKEN_TO_POSTGRES[token]);
      },
      onLiteralChar: (char) => {
        parts.push(char);
      },
    },
    writer
  );

  return writer ? writer.join(parts, '') : parts.join('');
};

export const buildDatetimeFormatSql = (
  datetimeSql: string,
  formatExpr?: string | null,
  timezoneOffsetSql: string = DEFAULT_TIMEZONE_OFFSET_SQL,
  writer?: IDatetimeFormatWriter
): string => {
  const formatLiteral = resolveFormatLiteral(formatExpr);
  if (formatLiteral == null) {
    const normalizedFormatSql = normalizeDatetimeFormatExpression(formatExpr, writer);
    return (writer?.sql ?? unmeteredSql)`TO_CHAR(${datetimeSql}, ${normalizedFormatSql})`;
  }

  const effectiveFormat = formatLiteral || DEFAULT_DATETIME_FORMAT_LITERAL;
  return buildDatetimeFormatSqlFromLiteral(datetimeSql, effectiveFormat, timezoneOffsetSql, writer);
};

export const normalizeDatetimeFormatExpression = (
  formatExpr?: string | null,
  writer?: IDatetimeFormatWriter
): string => {
  if (typeof formatExpr !== 'string') {
    return DEFAULT_DATETIME_FORMAT_EXPR;
  }

  const trimmed = formatExpr.trim();
  if (!trimmed) {
    return DEFAULT_DATETIME_FORMAT_EXPR;
  }

  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    return formatExpr;
  }

  const literal = trimmed.slice(1, -1);
  const normalizedLiteral = normalizeDatetimeFormatLiteral(literal, writer);
  return toSqlStringLiteral(normalizedLiteral, writer);
};

export const hasDatetimeTimezoneToken = (
  formatExpr?: string | null,
  writer?: IDatetimeFormatWriter
): boolean | null => {
  const formatLiteral = resolveFormatLiteral(formatExpr);
  if (formatLiteral == null) {
    return null;
  }

  let hasTimezoneToken = false;

  forEachSupportedDatetimeFormatToken(
    formatLiteral,
    {
      onToken: (token) => {
        if (timezoneFormatTokens.has(token)) {
          hasTimezoneToken = true;
        }
      },
      onLiteralChar: () => {
        return;
      },
    },
    writer
  );

  return hasTimezoneToken;
};

export const buildDatetimeParseGuardRegex = (
  formatExpr?: string | null,
  writer?: IDatetimeFormatWriter
): string | null => {
  const normalizedFormat = normalizeDatetimeFormatExpression(formatExpr, writer);
  const literal = parseSqlStringLiteral(normalizedFormat);
  if (literal == null) {
    return null;
  }

  const guardableTokens = (
    Object.keys(DATETIME_PARSE_GUARD_TOKEN_PATTERNS) as IGuardableDatetimeToken[]
  ).sort((a, b) => b.length - a.length);

  const parts = ['^'];

  for (let i = 0; i < literal.length; ) {
    let matched = false;
    // Tokens are ASCII and bounded in length; avoid copying the entire suffix
    // for every character of an arbitrary format literal.
    const upperRemaining = literal.slice(i, i + 4).toUpperCase();

    for (const token of guardableTokens) {
      if (upperRemaining.startsWith(token)) {
        parts.push(DATETIME_PARSE_GUARD_TOKEN_PATTERNS[token]);
        i += token.length;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    const optionalToken = upperRemaining.slice(0, 2);
    if (optionalDatetimeParseGuardTokens.has(optionalToken)) {
      i += optionalToken.length;
      continue;
    }

    const width = (literal.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    const currentChar = literal.slice(i, i + width);
    if (/\s/.test(currentChar)) {
      parts.push('\\s');
    } else {
      parts.push(currentChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    i += width;
  }

  // Dayjs custom parsing accepts trailing characters once the expected tokens match.
  parts.push('.*$');
  return writer ? writer.join(parts, '') : parts.join('');
};
