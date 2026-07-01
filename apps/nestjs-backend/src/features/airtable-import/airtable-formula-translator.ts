/**
 * Translates an Airtable formula into a Teable formula expression.
 *
 * The two languages are close enough to translate faithfully for a large common
 * subset: both reference fields as `{fldXXX}`, share the same operators
 * (`+ - * / & = != < > <= >= && ||`) and string/number/boolean literal syntax,
 * and overlap heavily on function names. Translation therefore only needs to:
 *   - remap function names that differ (e.g. ARRAYJOIN → ARRAY_JOIN),
 *   - turn Airtable's `TRUE()` / `FALSE()` calls into Teable's TRUE / FALSE
 *     boolean literals,
 *   - and refuse anything it cannot represent (an unknown function, the `^`
 *     power operator Teable's grammar lacks) so the importer can fall back to a
 *     static value snapshot instead of emitting a broken formula.
 *
 * Field references are preserved verbatim as `{fldXXX}` (Airtable field ids);
 * the import pipeline remaps those ids to the created Teable field ids, exactly
 * as it does for every other field-id reference.
 */

/** Airtable function name (upper-case) → Teable function name. */
const airtableToTeableFunction: Record<string, string> = {
  // Numeric — identical names
  ABS: 'ABS',
  AVERAGE: 'AVERAGE',
  CEILING: 'CEILING',
  COUNT: 'COUNT',
  COUNTA: 'COUNTA',
  COUNTALL: 'COUNTALL',
  EVEN: 'EVEN',
  EXP: 'EXP',
  FLOOR: 'FLOOR',
  INT: 'INT',
  LOG: 'LOG',
  MAX: 'MAX',
  MIN: 'MIN',
  MOD: 'MOD',
  ODD: 'ODD',
  POWER: 'POWER',
  ROUND: 'ROUND',
  ROUNDDOWN: 'ROUNDDOWN',
  ROUNDUP: 'ROUNDUP',
  SQRT: 'SQRT',
  SUM: 'SUM',
  VALUE: 'VALUE',

  // Text — identical names
  CONCATENATE: 'CONCATENATE',
  ENCODE_URL_COMPONENT: 'ENCODE_URL_COMPONENT',
  FIND: 'FIND',
  LEFT: 'LEFT',
  LEN: 'LEN',
  LOWER: 'LOWER',
  MID: 'MID',
  REPLACE: 'REPLACE',
  REPT: 'REPT',
  RIGHT: 'RIGHT',
  SEARCH: 'SEARCH',
  SUBSTITUTE: 'SUBSTITUTE',
  T: 'T',
  TRIM: 'TRIM',
  UPPER: 'UPPER',
  // Text — renamed
  REGEX_REPLACE: 'REGEXP_REPLACE',

  // Logical — identical names (TRUE/FALSE handled as literals, not here)
  AND: 'AND',
  BLANK: 'BLANK',
  ERROR: 'ERROR',
  IF: 'IF',
  NOT: 'NOT',
  OR: 'OR',
  SWITCH: 'SWITCH',
  XOR: 'XOR',
  // Logical — renamed
  ISERROR: 'IS_ERROR',

  // Date/time — identical names
  CREATED_TIME: 'CREATED_TIME',
  DATESTR: 'DATESTR',
  DATETIME_DIFF: 'DATETIME_DIFF',
  DATETIME_FORMAT: 'DATETIME_FORMAT',
  DATETIME_PARSE: 'DATETIME_PARSE',
  DAY: 'DAY',
  FROMNOW: 'FROMNOW',
  HOUR: 'HOUR',
  IS_AFTER: 'IS_AFTER',
  IS_BEFORE: 'IS_BEFORE',
  IS_SAME: 'IS_SAME',
  LAST_MODIFIED_TIME: 'LAST_MODIFIED_TIME',
  MINUTE: 'MINUTE',
  MONTH: 'MONTH',
  NOW: 'NOW',
  SECOND: 'SECOND',
  SET_LOCALE: 'SET_LOCALE',
  SET_TIMEZONE: 'SET_TIMEZONE',
  TIMESTR: 'TIMESTR',
  TODAY: 'TODAY',
  TONOW: 'TONOW',
  WEEKDAY: 'WEEKDAY',
  WEEKNUM: 'WEEKNUM',
  WORKDAY: 'WORKDAY',
  WORKDAY_DIFF: 'WORKDAY_DIFF',
  YEAR: 'YEAR',
  // Date/time — renamed
  DATEADD: 'DATE_ADD',

  // Array — renamed (Airtable drops the underscore)
  ARRAYCOMPACT: 'ARRAY_COMPACT',
  ARRAYFLATTEN: 'ARRAY_FLATTEN',
  ARRAYJOIN: 'ARRAY_JOIN',
  ARRAYUNIQUE: 'ARRAY_UNIQUE',

  // Record
  RECORD_ID: 'RECORD_ID',
};

export type IFormulaTranslation = { ok: true; expression: string } | { ok: false; reason: string };

type ITokenType = 'string' | 'field' | 'number' | 'ident' | 'punct' | 'ws';
interface IToken {
  type: ITokenType;
  raw: string;
}

// Airtable function names and the operators we recognize are all ASCII; field
// names never reach the tokenizer (they are opaque `{...}` spans).
const isWhitespace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdentStart = (c: string) => /[a-z_]/i.test(c);
const isIdentPart = (c: string) => /\w/.test(c);
const twoCharOperators = new Set(['!=', '<=', '>=', '&&', '||']);

/**
 * Splits a formula into structural tokens, keeping string and `{field}` spans
 * opaque so their contents are never mistaken for operators or identifiers.
 * Returns null on an unterminated string or field reference.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- a flat lexer dispatch
const tokenize = (input: string): IToken[] | null => {
  const tokens: IToken[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== c) {
        if (input[j] === '\\') j += 1;
        j += 1;
      }
      if (j >= input.length) return null;
      tokens.push({ type: 'string', raw: input.slice(i, j + 1) });
      i = j + 1;
    } else if (c === '{') {
      const end = input.indexOf('}', i + 1);
      if (end < 0) return null;
      tokens.push({ type: 'field', raw: input.slice(i, end + 1) });
      i = end + 1;
    } else if (isWhitespace(c)) {
      let j = i + 1;
      while (j < input.length && isWhitespace(input[j])) j += 1;
      tokens.push({ type: 'ws', raw: input.slice(i, j) });
      i = j;
    } else if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j])) j += 1;
      // optional exponent
      if ((input[j] === 'e' || input[j] === 'E') && j < input.length) {
        j += 1;
        if (input[j] === '+' || input[j] === '-') j += 1;
        while (j < input.length && isDigit(input[j])) j += 1;
      }
      tokens.push({ type: 'number', raw: input.slice(i, j) });
      i = j;
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (j < input.length && isIdentPart(input[j])) j += 1;
      tokens.push({ type: 'ident', raw: input.slice(i, j) });
      i = j;
    } else {
      const two = input.slice(i, i + 2);
      if (twoCharOperators.has(two)) {
        tokens.push({ type: 'punct', raw: two });
        i += 2;
      } else {
        tokens.push({ type: 'punct', raw: c });
        i += 1;
      }
    }
  }
  return tokens;
};

/** Index of the next non-whitespace token at or after `from`, or -1. */
const nextSignificant = (tokens: IToken[], from: number): number => {
  for (let k = from; k < tokens.length; k += 1) {
    if (tokens[k].type !== 'ws') return k;
  }
  return -1;
};

// eslint-disable-next-line sonarjs/cognitive-complexity -- a flat token-rewrite loop
export const translateAirtableFormula = (formula: string): IFormulaTranslation => {
  const trimmed = formula.trim();
  if (!trimmed) return { ok: false, reason: 'empty formula' };

  const tokens = tokenize(formula);
  if (!tokens)
    return { ok: false, reason: 'unparseable formula (unterminated string or field reference)' };

  const out: string[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'punct') {
      if (token.raw === '^') {
        return { ok: false, reason: 'unsupported operator "^" (power)' };
      }
      out.push(token.raw);
      continue;
    }
    if (token.type !== 'ident') {
      out.push(token.raw);
      continue;
    }

    const upper = token.raw.toUpperCase();
    const callParen = nextSignificant(tokens, k + 1);
    const isCall = callParen >= 0 && tokens[callParen].raw === '(';

    if (upper === 'TRUE' || upper === 'FALSE') {
      out.push(upper);
      if (isCall) {
        // Drop Airtable's empty `()`: TRUE() / FALSE() → TRUE / FALSE.
        const closeParen = nextSignificant(tokens, callParen + 1);
        if (closeParen < 0 || tokens[closeParen].raw !== ')') {
          return { ok: false, reason: `${upper}() called with arguments` };
        }
        k = closeParen;
      }
      continue;
    }

    if (!isCall) {
      return { ok: false, reason: `unrecognized name "${token.raw}"` };
    }
    const mapped = airtableToTeableFunction[upper];
    if (!mapped) {
      return { ok: false, reason: `unsupported function "${token.raw}"` };
    }
    out.push(mapped);
  }

  return { ok: true, expression: out.join('') };
};
