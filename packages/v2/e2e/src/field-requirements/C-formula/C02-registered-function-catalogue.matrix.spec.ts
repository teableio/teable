/**
 * C02 — the registered function catalogue.
 *
 * C02 (实现依据): the requirement document lists 81 registered functions and
 * asks for a confirmed input/output type per function. This spec pins the
 * catalogue itself so the document and the implementation cannot drift apart
 * silently: adding, renaming or removing a function fails here first.
 *
 * The document's §11 list is reproduced verbatim; the two extra names
 * (`SET_LOCALE`, `SET_TIMEZONE`) and the alias map below are the deltas the
 * document asks the developer to confirm.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { FunctionName, normalizeFunctionNameAlias } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';

/** §11 of the requirement document, grouped exactly as the document groups it. */
const DOCUMENTED_FUNCTIONS = {
  Numeric: [
    'SUM',
    'AVERAGE',
    'MAX',
    'MIN',
    'ROUND',
    'ROUNDUP',
    'ROUNDDOWN',
    'CEILING',
    'FLOOR',
    'EVEN',
    'ODD',
    'INT',
    'ABS',
    'SQRT',
    'POWER',
    'EXP',
    'LOG',
    'MOD',
    'VALUE',
  ],
  Text: [
    'CONCATENATE',
    'FIND',
    'SEARCH',
    'MID',
    'LEFT',
    'RIGHT',
    'REPLACE',
    'REGEXP_REPLACE',
    'SUBSTITUTE',
    'TEXTBEFORE',
    'TEXTSPLIT',
    'LOWER',
    'UPPER',
    'REPT',
    'TRIM',
    'LEN',
    'T',
    'ENCODE_URL_COMPONENT',
  ],
  Logical: ['IF', 'SWITCH', 'AND', 'OR', 'XOR', 'NOT', 'BLANK', 'ERROR', 'IS_ERROR'],
  DateTime: [
    'TODAY',
    'NOW',
    'YEAR',
    'MONTH',
    'WEEKNUM',
    'WEEKDAY',
    'DAY',
    'HOUR',
    'MINUTE',
    'SECOND',
    'FROMNOW',
    'TONOW',
    'DATETIME_DIFF',
    'WORKDAY',
    'WORKDAY_DIFF',
    'IS_SAME',
    'IS_AFTER',
    'IS_BEFORE',
    'DATE_ADD',
    'DATESTR',
    'TIMESTR',
    'DATETIME_FORMAT',
    'DATETIME_PARSE',
    'CREATED_TIME',
    'LAST_MODIFIED_TIME',
  ],
  Array: [
    'COUNTALL',
    'COUNTA',
    'COUNT',
    'ARRAY_JOIN',
    'ARRAY_UNIQUE',
    'ARRAY_FLATTEN',
    'ARRAY_COMPACT',
  ],
  System: ['TEXT_ALL', 'RECORD_ID', 'AUTO_NUMBER'],
} as const;

const documentedNames = Object.values(DOCUMENTED_FUNCTIONS).flat();
const registeredNames = Object.values(FunctionName);

/** Documented as "另行核对" — the editor-visible delta against the source list. */
const DOCUMENTED_DELTA = ['SET_LOCALE', 'SET_TIMEZONE'];

/** Legacy spellings kept working for existing formulas. */
const EXPECTED_ALIASES: Record<string, string> = {
  ARRAYJOIN: FunctionName.ArrayJoin,
  ARRAYUNIQUE: FunctionName.ArrayUnique,
  ARRAYFLATTEN: FunctionName.ArrayFlatten,
  ARRAYCOMPACT: FunctionName.ArrayCompact,
};

describe('C02: registered formula function catalogue', () => {
  it('the document lists 81 functions', () => {
    expect(documentedNames).toHaveLength(81);
    expect(new Set(documentedNames).size).toBe(81);
  });

  it('every documented function is registered', () => {
    const missing = documentedNames.filter(
      (name) => !(registeredNames as ReadonlyArray<string>).includes(name)
    );
    expect(missing).toEqual([]);
  });

  it('the registry contains only documented functions plus the recorded delta', () => {
    const expected = new Set<string>([...documentedNames, ...DOCUMENTED_DELTA]);
    const undeclared = (registeredNames as ReadonlyArray<string>).filter(
      (name) => !expected.has(name)
    );
    expect(undeclared).toEqual([]);
  });

  describe.each(Object.entries(DOCUMENTED_FUNCTIONS))('%s functions', (_group, names) => {
    it.each(names)('registers %s', (name) => {
      expect(registeredNames as ReadonlyArray<string>).toContain(name);
    });
  });

  it.each(DOCUMENTED_DELTA)(
    'registers the undocumented %s so the document can confirm it',
    (name) => {
      // These ship in the editor list but are absent from §11 of the document.
      expect(registeredNames as ReadonlyArray<string>).toContain(name);
    }
  );

  describe('aliases', () => {
    it.each(Object.entries(EXPECTED_ALIASES))('resolves %s to %s', (alias, canonical) => {
      expect(normalizeFunctionNameAlias(alias)).toBe(canonical);
    });

    it('leaves an unknown token untouched', () => {
      expect(normalizeFunctionNameAlias('NOT_A_FUNCTION')).toBe('NOT_A_FUNCTION');
    });

    it('leaves the canonical spelling untouched', () => {
      expect(normalizeFunctionNameAlias(FunctionName.ArrayJoin)).toBe(FunctionName.ArrayJoin);
    });
  });
});
