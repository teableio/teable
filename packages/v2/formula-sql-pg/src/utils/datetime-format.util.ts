/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Normalize Moment-style datetime format strings to PostgreSQL TO_CHAR/TO_TIMESTAMP patterns.
 * - HH / H are treated as 24-hour tokens (HH24 / FMHH24)
 * - hh / h map to 12-hour tokens (HH12 / FMHH12)
 * - mm / m map to minute tokens (MI / FMMI)
 * - ss / s map to second tokens (SS / FMSS)
 * Other common tokens are passed through as-is.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const DEFAULT_DATETIME_FORMAT_EXPR = "'YYYY-MM-DD'";

const DEFAULT_DATETIME_FORMAT_LITERAL = 'YYYY-MM-DD';

const LOCALIZED_FORMAT_MAP: Record<string, string> = {
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
};

const LOCALIZED_TOKENS = Object.keys(LOCALIZED_FORMAT_MAP).sort((a, b) => b.length - a.length);

const DATE_TOKEN_SQL_BUILDERS: ReadonlyArray<{
  token: string;
  buildSql: (datetimeSql: string, timezoneOffsetSql: string) => string;
}> = [
  { token: 'HH24', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'HH24')` },
  { token: 'HH12', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'HH12')` },
  { token: 'MI', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'MI')` },
  { token: 'MS', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'MS')` },
  { token: 'SS', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'SS')` },
  { token: 'Month', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMMonth')` },
  { token: 'MONTH', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMMONTH')` },
  { token: 'month', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMmonth')` },
  { token: 'Day', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMDay')` },
  { token: 'DAY', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMDAY')` },
  { token: 'day', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMday')` },
  { token: 'YYYY', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'YYYY')` },
  { token: 'MMMM', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMMonth')` },
  { token: 'dddd', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMDay')` },
  { token: 'ddd', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMDy')` },
  {
    token: 'dd',
    buildSql: (valueSql) => `LEFT(TO_CHAR(${valueSql}, 'FMDy'), 2)`,
  },
  {
    token: 'd',
    buildSql: (valueSql) => `EXTRACT(DOW FROM ${valueSql})::int::text`,
  },
  { token: 'MMM', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMMon')` },
  { token: 'YY', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'YY')` },
  { token: 'MM', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'MM')` },
  { token: 'M', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMMM')` },
  { token: 'DD', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'DD')` },
  { token: 'D', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMDD')` },
  { token: 'HH', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'HH24')` },
  { token: 'H', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMHH24')` },
  { token: 'hh', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'HH12')` },
  { token: 'h', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMHH12')` },
  { token: 'mm', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'MI')` },
  { token: 'm', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMMI')` },
  { token: 'ss', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'SS')` },
  { token: 's', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'FMSS')` },
  { token: 'SSS', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'MS')` },
  {
    token: 'ZZ',
    buildSql: (_valueSql, timezoneOffsetSql) => `REPLACE(${timezoneOffsetSql}, ':', '')`,
  },
  { token: 'Z', buildSql: (_valueSql, timezoneOffsetSql) => timezoneOffsetSql },
  { token: 'A', buildSql: (valueSql) => `TO_CHAR(${valueSql}, 'AM')` },
  { token: 'a', buildSql: (valueSql) => `LOWER(TO_CHAR(${valueSql}, 'AM'))` },
];

const SORTED_DATE_TOKEN_SQL_BUILDERS = [...DATE_TOKEN_SQL_BUILDERS].sort(
  (a, b) => b.token.length - a.token.length
);

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

const expandLocalizedTokens = (literal: string): string => {
  let result = '';

  for (let i = 0; i < literal.length; ) {
    const remaining = literal.slice(i);
    const token = LOCALIZED_TOKENS.find((candidate) => remaining.startsWith(candidate));
    if (token) {
      if (token.length === 1 && !shouldMatchSingleCharToken(literal, i)) {
        result += literal[i];
        i += 1;
        continue;
      }
      result += LOCALIZED_FORMAT_MAP[token];
      i += token.length;
      continue;
    }

    result += literal[i];
    i += 1;
  }

  return result;
};

const buildDatetimeFormatSqlFromLiteral = (
  datetimeSql: string,
  formatLiteral: string,
  timezoneOffsetSql: string
): string => {
  const expandedLiteral = expandLocalizedTokens(formatLiteral);
  const sqlParts: string[] = [];
  let literalBuffer = '';

  const flushLiteral = () => {
    if (!literalBuffer) {
      return;
    }
    sqlParts.push(toSqlStringLiteral(literalBuffer));
    literalBuffer = '';
  };

  for (let i = 0; i < expandedLiteral.length; ) {
    const remaining = expandedLiteral.slice(i);
    const tokenMatch = SORTED_DATE_TOKEN_SQL_BUILDERS.find(({ token }) =>
      remaining.startsWith(token)
    );

    if (tokenMatch) {
      if (tokenMatch.token.length === 1 && !shouldMatchSingleCharToken(expandedLiteral, i)) {
        literalBuffer += expandedLiteral[i];
        i += 1;
        continue;
      }

      flushLiteral();
      sqlParts.push(tokenMatch.buildSql(datetimeSql, timezoneOffsetSql));
      i += tokenMatch.token.length;
      continue;
    }

    literalBuffer += expandedLiteral[i];
    i += 1;
  }

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

const normalizeDatetimeFormatLiteral = (literal: string): string => {
  const tokenMap: Array<{ token: string; replacement: string }> = [
    // Passthrough Postgres tokens to avoid double-conversion
    { token: 'HH24', replacement: 'HH24' },
    { token: 'HH12', replacement: 'HH12' },
    { token: 'MI', replacement: 'MI' },
    { token: 'MS', replacement: 'MS' },
    { token: 'SS', replacement: 'SS' },
    // Common Postgres textual tokens (add FM to avoid padding)
    { token: 'Month', replacement: 'FMMonth' },
    { token: 'MONTH', replacement: 'FMMONTH' },
    { token: 'month', replacement: 'FMmonth' },
    { token: 'Day', replacement: 'FMDay' },
    { token: 'DAY', replacement: 'FMDAY' },
    { token: 'day', replacement: 'FMday' },
    // Moment style tokens
    { token: 'dddd', replacement: 'FMDay' },
    { token: 'ddd', replacement: 'FMDy' },
    { token: 'dd', replacement: 'FMDy' },
    { token: 'd', replacement: 'D' },
    { token: 'YYYY', replacement: 'YYYY' },
    { token: 'YY', replacement: 'YY' },
    { token: 'MMMM', replacement: 'FMMonth' },
    { token: 'MMM', replacement: 'FMMon' },
    { token: 'MM', replacement: 'MM' },
    { token: 'M', replacement: 'FMMM' },
    { token: 'DD', replacement: 'DD' },
    { token: 'D', replacement: 'FMDD' },
    { token: 'HH', replacement: 'HH24' },
    { token: 'H', replacement: 'FMHH24' },
    { token: 'hh', replacement: 'HH12' },
    { token: 'h', replacement: 'FMHH12' },
    { token: 'mm', replacement: 'MI' },
    { token: 'm', replacement: 'FMMI' },
    { token: 'ss', replacement: 'SS' },
    { token: 's', replacement: 'FMSS' },
    { token: 'SSS', replacement: 'MS' },
    { token: 'Z', replacement: 'OF' },
    { token: 'ZZ', replacement: 'OF' },
    { token: 'A', replacement: 'AM' },
    { token: 'a', replacement: 'am' },
  ];

  const tokens = tokenMap.sort((a, b) => b.token.length - a.token.length);
  let result = '';

  for (let i = 0; i < literal.length; ) {
    const slice = literal.slice(i);
    const match = tokens.find(({ token }) => slice.startsWith(token));
    if (match) {
      if (match.token.length === 1) {
        const prevChar = i > 0 ? literal[i - 1] : '';
        const nextChar = i + 1 < literal.length ? literal[i + 1] : '';
        const prevIsAlpha = /[A-Z]/i.test(prevChar);
        const nextIsAlpha = /[A-Z]/i.test(nextChar);
        if (!prevIsAlpha && !nextIsAlpha) {
          result += match.replacement;
          i += 1;
          continue;
        }
      } else {
        result += match.replacement;
        i += match.token.length;
        continue;
      }
    }

    result += literal[i];
    i += 1;
  }

  return result;
};
