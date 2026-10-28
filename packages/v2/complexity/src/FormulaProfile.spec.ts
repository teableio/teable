import { describe, expect, it } from 'vitest';

import { inspectFormulaProfile, type FormulaProfile } from './FormulaProfile';

const fieldA = `fld${'a'.repeat(16)}`;
const fieldB = `fld${'b'.repeat(16)}`;

const expectIncomplete = (profile: FormulaProfile, status: 'invalid' | 'truncated') => {
  expect(profile.status).toBe(status);
  expect(profile.astDepth).toBeNull();
  expect(profile.astNodeCount).toBeNull();
  expect(profile.parseTreeNodeCount).toBeNull();
  expect(profile.referenceCount).toBeNull();
  expect(profile.uniqueReferenceCount).toBeNull();
  expect(profile.functionCalls).toEqual({});
  expect(profile.functionCallsByCategory).toEqual({});
  expect(profile.contextFree).toBeNull();
  expect(profile.recordContext).toBe(false);
  expect(profile.volatile).toBe(false);
  expect(profile.warnings.length).toBeGreaterThan(0);
};

describe('inspectFormulaProfile', () => {
  it('profiles literals and field references', () => {
    const literal = inspectFormulaProfile('42');
    expect(literal).toMatchObject({
      status: 'ok',
      astDepth: 1,
      astNodeCount: 1,
      referenceCount: 0,
      uniqueReferenceCount: 0,
      contextFree: true,
      recordContext: false,
      volatile: false,
    });
    expect(literal.parseTreeNodeCount).toBe(4);
    expect(literal.functionCalls).toEqual({});

    const reference = inspectFormulaProfile(`{${fieldA}}`);
    expect(reference).toMatchObject({
      status: 'ok',
      astDepth: 1,
      astNodeCount: 1,
      referenceCount: 1,
      uniqueReferenceCount: 1,
      contextFree: false,
    });

    const repeated = inspectFormulaProfile(`{${fieldA}} + {${fieldA}}`);
    expect(repeated).toMatchObject({
      status: 'ok',
      astDepth: 2,
      astNodeCount: 3,
      referenceCount: 2,
      uniqueReferenceCount: 1,
      contextFree: false,
    });
  });

  it('profiles nested functions and groups them by category', () => {
    const profile = inspectFormulaProfile(
      `IF({${fieldA}} > 0, ROUND(SUM({${fieldB}}), 2), TODAY())`
    );

    expect(profile).toMatchObject({
      status: 'ok',
      astDepth: 4,
      astNodeCount: 9,
      referenceCount: 2,
      uniqueReferenceCount: 2,
      contextFree: false,
      recordContext: false,
      volatile: true,
      warnings: [],
    });
    expect(profile.functionCalls).toEqual({
      IF: 1,
      ROUND: 1,
      SUM: 1,
      TODAY: 1,
    });
    expect(profile.functionCallsByCategory).toEqual({
      logical: 1,
      numeric: 2,
      dateTime: 1,
    });
  });

  it('normalizes aliases and classifies unknown functions', () => {
    const aliases = inspectFormulaProfile(`ARRAYJOIN(ARRAYUNIQUE({${fieldA}}), ",")`);
    expect(aliases.functionCalls).toEqual({ ARRAY_JOIN: 1, ARRAY_UNIQUE: 1 });
    expect(aliases.functionCallsByCategory).toEqual({ array: 2 });
    expect(aliases).toMatchObject({ astDepth: 3, astNodeCount: 4, referenceCount: 1 });

    const unknown = inspectFormulaProfile('MYSTERY(1)');
    expect(unknown.functionCalls).toEqual({ MYSTERY: 1 });
    expect(unknown.functionCallsByCategory).toEqual({ unknown: 1 });
  });

  it('ignores grammar wrappers for semantic metrics but counts them in the parse tree', () => {
    const compact = inspectFormulaProfile('1+2');
    const wrapped = inspectFormulaProfile(' ( 1 /* note */ + 2 ) ');

    expect(compact).toMatchObject({ astDepth: 2, astNodeCount: 3, parseTreeNodeCount: 8 });
    expect(wrapped).toMatchObject({ astDepth: 2, astNodeCount: 3 });
    expect(wrapped.parseTreeNodeCount).not.toBeNull();
    expect(compact.parseTreeNodeCount).not.toBeNull();
    expect(wrapped.parseTreeNodeCount as number).toBeGreaterThan(
      compact.parseTreeNodeCount as number
    );
  });

  it.each<[string, boolean, boolean, boolean]>([
    ['NOW()', true, false, true],
    ['TODAY()', true, false, true],
    ['FROMNOW()', true, false, true],
    ['TONOW()', true, false, true],
  ])(
    'marks %s as context-free and volatile',
    (expression: string, contextFree: boolean, recordContext: boolean, volatile: boolean) => {
      const profile = inspectFormulaProfile(expression);
      expect(profile).toMatchObject({ status: 'ok', contextFree, recordContext, volatile });
      expect(profile.referenceCount).toBe(0);
    }
  );

  it.each<[string, boolean, boolean]>([
    ['RECORD_ID()', true, true],
    ['AUTO_NUMBER()', true, true],
    ['CREATED_TIME()', true, true],
    ['LAST_MODIFIED_TIME()', true, true],
    [`TEXT_ALL({${fieldA}})`, false, true],
  ])(
    'marks %s as record-dependent',
    (expression: string, contextFree: boolean, recordContext: boolean) => {
      const profile = inspectFormulaProfile(expression);
      expect(profile).toMatchObject({
        status: 'ok',
        contextFree,
        recordContext,
        volatile: false,
      });
    }
  );

  it('rejects empty sources without reporting metrics', () => {
    const empty = inspectFormulaProfile('   ');
    expectIncomplete(empty, 'invalid');
    expect(empty.warnings[0]).toBe('Formula source is empty');
  });

  it.each<[string, string]>([
    ['INCOMPLETE function call', `IF({${fieldA}},`],
    ['unexpected token', '1 + @'],
    ['unterminated string', "CONCATENATE('abc)"],
  ])('rejects malformed %s without reporting metrics', (_name: string, expression: string) => {
    expectIncomplete(inspectFormulaProfile(expression), 'invalid');
  });

  it('does not echo stored source text in syntax warnings', () => {
    const profile = inspectFormulaProfile('1 "customer-secret"');
    expectIncomplete(profile, 'invalid');
    expect(profile.warnings.join(' ')).not.toContain('customer-secret');
  });

  it('reports truncation instead of parsing without admission limits', () => {
    const deepUnary = inspectFormulaProfile(`${'-'.repeat(100)}1`);
    expectIncomplete(deepUnary, 'truncated');
    expect(deepUnary.warnings[0]).toContain('AST depth limit');

    const leftAssociative = ['1', ...Array.from({ length: 100 }, () => '1')].join('+');
    const wide = inspectFormulaProfile(leftAssociative);
    expectIncomplete(wide, 'truncated');
    expect(wide.warnings[0]).toContain('AST depth limit');
  });
});
