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

type IDatetimeFormatSqlBuilder = (datetimeSql: string, timezoneOffsetSql: string) => string;

export const DATETIME_FORMAT_SQL_BUILDERS = {
  HH24: (valueSql) => `TO_CHAR(${valueSql}, 'HH24')`,
  HH12: (valueSql) => `TO_CHAR(${valueSql}, 'HH12')`,
  MI: (valueSql) => `TO_CHAR(${valueSql}, 'MI')`,
  MS: (valueSql) => `TO_CHAR(${valueSql}, 'MS')`,
  SS: (valueSql) => `TO_CHAR(${valueSql}, 'SS')`,
  Month: (valueSql) => `TO_CHAR(${valueSql}, 'FMMonth')`,
  MONTH: (valueSql) => `TO_CHAR(${valueSql}, 'FMMONTH')`,
  month: (valueSql) => `TO_CHAR(${valueSql}, 'FMmonth')`,
  Day: (valueSql) => `TO_CHAR(${valueSql}, 'FMDay')`,
  DAY: (valueSql) => `TO_CHAR(${valueSql}, 'FMDAY')`,
  day: (valueSql) => `TO_CHAR(${valueSql}, 'FMday')`,
  YYYY: (valueSql) => `TO_CHAR(${valueSql}, 'YYYY')`,
  MMMM: (valueSql) => `TO_CHAR(${valueSql}, 'FMMonth')`,
  dddd: (valueSql) => `TO_CHAR(${valueSql}, 'FMDay')`,
  ddd: (valueSql) => `TO_CHAR(${valueSql}, 'FMDy')`,
  dd: (valueSql) => `LEFT(TO_CHAR(${valueSql}, 'FMDy'), 2)`,
  d: (valueSql) => `EXTRACT(DOW FROM ${valueSql})::int::text`,
  MMM: (valueSql) => `TO_CHAR(${valueSql}, 'FMMon')`,
  YY: (valueSql) => `TO_CHAR(${valueSql}, 'YY')`,
  MM: (valueSql) => `TO_CHAR(${valueSql}, 'MM')`,
  M: (valueSql) => `TO_CHAR(${valueSql}, 'FMMM')`,
  DD: (valueSql) => `TO_CHAR(${valueSql}, 'DD')`,
  D: (valueSql) => `TO_CHAR(${valueSql}, 'FMDD')`,
  HH: (valueSql) => `TO_CHAR(${valueSql}, 'HH24')`,
  H: (valueSql) => `TO_CHAR(${valueSql}, 'FMHH24')`,
  hh: (valueSql) => `TO_CHAR(${valueSql}, 'HH12')`,
  h: (valueSql) => `TO_CHAR(${valueSql}, 'FMHH12')`,
  mm: (valueSql) => `TO_CHAR(${valueSql}, 'MI')`,
  m: (valueSql) => `TO_CHAR(${valueSql}, 'FMMI')`,
  ss: (valueSql) => `TO_CHAR(${valueSql}, 'SS')`,
  s: (valueSql) => `TO_CHAR(${valueSql}, 'FMSS')`,
  SSS: (valueSql) => `TO_CHAR(${valueSql}, 'MS')`,
  ZZ: (_valueSql, timezoneOffsetSql) => `REPLACE(${timezoneOffsetSql}, ':', '')`,
  Z: (_valueSql, timezoneOffsetSql) => timezoneOffsetSql,
  A: (valueSql) => `TO_CHAR(${valueSql}, 'AM')`,
  a: (valueSql) => `LOWER(TO_CHAR(${valueSql}, 'AM'))`,
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

const toSqlStringLiteral = (literal: string): string => `'${literal.replace(/'/g, "''")}'`;

const parseSqlStringLiteral = (expr: string): string | null => {
  const trimmed = expr.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    return null;
  }

  return trimmed.slice(1, -1).replace(/''/g, "'");
};

const shouldMatchSingleCharToken = (literal: string, index: number): boolean => {
  const prevChar = index > 0 ? literal[index - 1] : '';
  const nextChar = index + 1 < literal.length ? literal[index + 1] : '';
  const prevIsAlpha = /[A-Z]/i.test(prevChar);
  const nextIsAlpha = /[A-Z]/i.test(nextChar);
  return !prevIsAlpha && !nextIsAlpha;
};

export const expandLocalizedDatetimeFormat = (literal: string): string => {
  let result = '';

  for (let i = 0; i < literal.length; ) {
    const remaining = literal.slice(i);
    const token = sortedLocalizedDatetimeFormatTokens.find((candidate) =>
      remaining.startsWith(candidate)
    );

    if (token) {
      if (token.length === 1 && !shouldMatchSingleCharToken(literal, i)) {
        result += literal[i];
        i += 1;
        continue;
      }

      result += LOCALIZED_DATETIME_FORMAT_MAP[token];
      i += token.length;
      continue;
    }

    result += literal[i];
    i += 1;
  }

  return result;
};

const forEachSupportedDatetimeFormatToken = (
  literal: string,
  options: {
    onToken: (token: ISupportedDatetimeFormatToken) => void;
    onLiteralChar: (char: string) => void;
  }
) => {
  const expandedLiteral = expandLocalizedDatetimeFormat(literal);

  for (let i = 0; i < expandedLiteral.length; ) {
    const remaining = expandedLiteral.slice(i);
    const token = sortedSupportedDatetimeFormatTokens.find((candidate) =>
      remaining.startsWith(candidate)
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

    options.onLiteralChar(expandedLiteral[i]);
    i += 1;
  }
};

const buildDatetimeFormatSqlFromLiteral = (
  datetimeSql: string,
  formatLiteral: string,
  timezoneOffsetSql: string
): string => {
  const sqlParts: string[] = [];
  let literalBuffer = '';

  const flushLiteral = () => {
    if (!literalBuffer) {
      return;
    }

    sqlParts.push(toSqlStringLiteral(literalBuffer));
    literalBuffer = '';
  };

  forEachSupportedDatetimeFormatToken(formatLiteral, {
    onToken: (token) => {
      flushLiteral();
      sqlParts.push(DATETIME_FORMAT_SQL_BUILDERS[token](datetimeSql, timezoneOffsetSql));
    },
    onLiteralChar: (char) => {
      literalBuffer += char;
    },
  });

  flushLiteral();

  if (!sqlParts.length) {
    return "''";
  }

  return sqlParts.join(' || ');
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

const normalizeDatetimeFormatLiteral = (literal: string): string => {
  let result = '';

  forEachSupportedDatetimeFormatToken(literal, {
    onToken: (token) => {
      result += DATETIME_FORMAT_TOKEN_TO_POSTGRES[token];
    },
    onLiteralChar: (char) => {
      result += char;
    },
  });

  return result;
};

export const buildDatetimeFormatSql = (
  datetimeSql: string,
  formatExpr?: string | null,
  timezoneOffsetSql: string = DEFAULT_TIMEZONE_OFFSET_SQL
): string => {
  const formatLiteral = resolveFormatLiteral(formatExpr);
  if (formatLiteral == null) {
    const normalizedFormatSql = normalizeDatetimeFormatExpression(formatExpr);
    return `TO_CHAR(${datetimeSql}, ${normalizedFormatSql})`;
  }

  const effectiveFormat = formatLiteral || DEFAULT_DATETIME_FORMAT_LITERAL;
  return buildDatetimeFormatSqlFromLiteral(datetimeSql, effectiveFormat, timezoneOffsetSql);
};

export const normalizeDatetimeFormatExpression = (formatExpr?: string | null): string => {
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
  const normalizedLiteral = normalizeDatetimeFormatLiteral(literal);
  const escaped = normalizedLiteral.replace(/'/g, "''");
  return `'${escaped}'`;
};

export const hasDatetimeTimezoneToken = (formatExpr?: string | null): boolean | null => {
  const formatLiteral = resolveFormatLiteral(formatExpr);
  if (formatLiteral == null) {
    return null;
  }

  let hasTimezoneToken = false;

  forEachSupportedDatetimeFormatToken(formatLiteral, {
    onToken: (token) => {
      if (timezoneFormatTokens.has(token)) {
        hasTimezoneToken = true;
      }
    },
    onLiteralChar: () => {
      return;
    },
  });

  return hasTimezoneToken;
};

export const buildDatetimeParseGuardRegex = (formatExpr?: string | null): string | null => {
  const normalizedFormat = normalizeDatetimeFormatExpression(formatExpr);
  const literal = parseSqlStringLiteral(normalizedFormat);
  if (literal == null) {
    return null;
  }

  const guardableTokens = (
    Object.keys(DATETIME_PARSE_GUARD_TOKEN_PATTERNS) as IGuardableDatetimeToken[]
  ).sort((a, b) => b.length - a.length);

  let pattern = '^';

  for (let i = 0; i < literal.length; ) {
    let matched = false;
    const remaining = literal.slice(i);
    const upperRemaining = remaining.toUpperCase();

    for (const token of guardableTokens) {
      if (upperRemaining.startsWith(token)) {
        pattern += DATETIME_PARSE_GUARD_TOKEN_PATTERNS[token];
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

    const currentChar = literal[i];
    if (/\s/.test(currentChar)) {
      pattern += '\\s';
    } else {
      pattern += currentChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    i += 1;
  }

  // Dayjs custom parsing accepts trailing characters once the expected tokens match.
  pattern += '.*$';
  return pattern;
};
