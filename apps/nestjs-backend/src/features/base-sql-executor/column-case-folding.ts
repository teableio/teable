import type { AST } from 'node-sql-parser';

/**
 * PostgreSQL folds an unquoted identifier to lower case before resolving it, and
 * reports the folded name when the column is missing. Teable column names keep the
 * case they were created with — link columns are `__fk_<fieldId>`, and field ids are
 * mixed case — so an unquoted `__fk_fldXxxYyy` only resolves when the physical
 * column happens to be lower case. The folded name in the error message hides that
 * cause, which is why the executor names it back to the caller.
 */

/** Identifiers a hint can list before it stops being readable. */
const LISTED_IDENTIFIER_LIMIT = 3;

type ColumnExpression = { readonly quoted: boolean; readonly value: string };

const asColumnExpression = (node: unknown): ColumnExpression | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }
  const columnRef = node as { type?: unknown; column?: unknown };
  if (columnRef.type !== 'column_ref') {
    return null;
  }
  const expr = (columnRef.column as { expr?: { type?: unknown; value?: unknown } } | undefined)
    ?.expr;
  // node-sql-parser keeps the written case and marks quoting: a double-quoted
  // identifier arrives as `double_quote_string`, an unquoted one as `default`. A star
  // projection carries no expression at all.
  if (typeof expr?.value !== 'string') {
    return null;
  }
  if (expr.type === 'default') {
    return { quoted: false, value: expr.value };
  }
  if (expr.type === 'double_quote_string') {
    return { quoted: true, value: expr.value };
  }
  return null;
};

const collectColumnExpressions = (
  ast: AST | AST[],
  wanted: (column: ColumnExpression) => boolean
): string[] => {
  const found: string[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const column = asColumnExpression(node);
    if (column && wanted(column) && !seen.has(column.value)) {
      seen.add(column.value);
      found.push(column.value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach(visit);
        continue;
      }
      visit(value);
    }
  };
  visit(ast);
  return found;
};

/**
 * Column references written without double quotes that still contain an upper-case
 * letter, in statement order. Only these can be folded to a different name than the
 * one the query asks for.
 */
export const collectUnquotedMixedCaseColumns = (ast: AST | AST[]): string[] =>
  collectColumnExpressions(ast, (column) => !column.quoted && /[A-Z]/.test(column.value));

/** Column references written with double quotes, whose names never fold. */
export const collectQuotedColumnNames = (ast: AST | AST[]): string[] =>
  collectColumnExpressions(ast, (column) => column.quoted);

export const buildCaseFoldingHint = (identifiers: readonly string[]): string => {
  const listed = identifiers.slice(0, LISTED_IDENTIFIER_LIMIT);
  const quoted = listed.map((identifier) => `"${identifier}"`).join(', ');
  const remaining = identifiers.length - listed.length;
  const suffix = remaining > 0 ? ` (and ${remaining} more)` : '';
  return (
    `Hint: PostgreSQL folds unquoted identifiers to lower case, so ${listed
      .map((identifier) => `\`${identifier.toLowerCase()}\``)
      .join(', ')} was looked up instead of ${quoted}${suffix}. ` +
    `Teable column names keep their original case, including link columns named \`__fk_<fieldId>\`; ` +
    `write every identifier double-quoted, for example WHERE ${quoted.split(', ')[0]} = 'recXXX'.`
  );
};

/**
 * The reference PostgreSQL named in the message, as written: `"missing"` for an
 * unqualified reference, `t.missing` when a qualifier was present. Only the column
 * part is quoted, so a qualifier cannot always be told apart from a quoted identifier
 * that contains dots.
 */
const MISSING_COLUMN_PATTERN = /column (.+?) does not exist/;

export const parseMissingColumnReference = (message: string): string | null =>
  MISSING_COLUMN_PATTERN.exec(message)?.[1]?.trim() || null;

/**
 * Best-effort name behind that reference: the trailing dotted segment, unquoted. A
 * quoted identifier that itself contains dots (`"foo.bar"`) is indistinguishable from a
 * qualifier here, so callers must cross-check the AST — see `buildMissingColumnHint`.
 */
export const parseMissingColumnName = (message: string): string | null => {
  const reference = parseMissingColumnReference(message);
  if (!reference) {
    return null;
  }
  const tail = reference.split('.').at(-1) ?? '';
  return tail.replace(/^"|"$/g, '') || null;
};

/**
 * A folding hint, but only when the column PostgreSQL reported missing is an unquoted
 * mixed-case identifier in the statement. A statement may carry unrelated unquoted
 * mixed-case identifiers that resolved fine, and a reference that matches a
 * double-quoted identifier was written with quotes, so neither case gets a hint
 * recommending quotes.
 */
export const buildMissingColumnHint = (message: string, ast: AST | AST[]): string | null => {
  const reference = parseMissingColumnReference(message);
  const reportedName = parseMissingColumnName(message);
  if (!reference || !reportedName) {
    return null;
  }
  const writtenQuoted = collectQuotedColumnNames(ast).some(
    (quoted) =>
      reference === quoted || reference === `"${quoted}"` || reference.endsWith(`.${quoted}`)
  );
  if (writtenQuoted) {
    return null;
  }
  const folded = reportedName.toLowerCase();
  const matching = collectUnquotedMixedCaseColumns(ast).filter(
    (identifier) => identifier.toLowerCase() === folded
  );
  return matching.length ? buildCaseFoldingHint(matching) : null;
};
