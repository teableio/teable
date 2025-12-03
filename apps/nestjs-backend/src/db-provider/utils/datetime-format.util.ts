/**
 * Normalize Airtable/Moment-style datetime format strings to PostgreSQL TO_CHAR/TO_TIMESTAMP patterns.
 * - HH / H are treated as 24-hour tokens (HH24 / FMHH24)
 * - hh / h map to 12-hour tokens (HH12 / FMHH12)
 * - mm / m map to minute tokens (MI / FMMI)
 * - ss / s map to second tokens (SS / FMSS)
 * Other common tokens are passed through as-is.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const DEFAULT_DATETIME_FORMAT_EXPR = "'YYYY-MM-DD'";

export const normalizeAirtableDatetimeFormatExpression = (formatExpr?: string | null): string => {
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
  const normalizedLiteral = normalizeAirtableDatetimeFormatLiteral(literal);
  const escaped = normalizedLiteral.replace(/'/g, "''");
  return `'${escaped}'`;
};

const normalizeAirtableDatetimeFormatLiteral = (literal: string): string => {
  const tokenMap: Array<{ token: string; replacement: string }> = [
    // Passthrough Postgres tokens to avoid double-conversion
    { token: 'HH24', replacement: 'HH24' },
    { token: 'HH12', replacement: 'HH12' },
    { token: 'MI', replacement: 'MI' },
    { token: 'MS', replacement: 'MS' },
    { token: 'SS', replacement: 'SS' },
    // Airtable/Moment style tokens
    { token: 'YYYY', replacement: 'YYYY' },
    { token: 'YY', replacement: 'YY' },
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
    { token: 'A', replacement: 'AM' },
    { token: 'a', replacement: 'am' },
  ];

  const tokens = tokenMap.sort((a, b) => b.token.length - a.token.length);
  let result = '';

  for (let i = 0; i < literal.length; ) {
    const slice = literal.slice(i);
    const match = tokens.find(({ token }) => slice.startsWith(token));
    if (match) {
      result += match.replacement;
      i += match.token.length;
      continue;
    }

    result += literal[i];
    i += 1;
  }

  return result;
};
