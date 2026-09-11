import { describe, expect, it } from 'vitest';

import { FormulaParseCache, parseFormulaExpression } from './FormulaParseCache';

describe('formula syntax cache', () => {
  it('reuses a tree for identical source without normalizing literals or whitespace', () => {
    const cache = new FormulaParseCache();
    const first = cache.parse('"hello"')._unsafeUnwrap();
    expect(cache.parse('"hello"')._unsafeUnwrap()).toBe(first);
    expect(cache.parse('"Hello"')._unsafeUnwrap()).not.toBe(first);
    expect(cache.parse(' "hello"')._unsafeUnwrap()).not.toBe(first);
  });

  it('evicts the least recently used tree at the entry limit', () => {
    const cache = new FormulaParseCache(2);
    const first = cache.parse('1')._unsafeUnwrap();
    const second = cache.parse('2')._unsafeUnwrap();
    expect(cache.parse('1')._unsafeUnwrap()).toBe(first);
    cache.parse('3');
    expect(cache.parse('1')._unsafeUnwrap()).toBe(first);
    expect(cache.parse('2')._unsafeUnwrap()).not.toBe(second);
  });

  it('bounds aggregate retained source and bypasses oversized expressions', () => {
    const cache = new FormulaParseCache(10, 5, 4);
    const first = cache.parse('111')._unsafeUnwrap();
    cache.parse('222');
    expect(cache.parse('111')._unsafeUnwrap()).not.toBe(first);
    const oversized = cache.parse('12345')._unsafeUnwrap();
    expect(cache.parse('12345')._unsafeUnwrap()).not.toBe(oversized);
    const noCapacity = new FormulaParseCache(0);
    expect(noCapacity.parse('1')._unsafeUnwrap()).not.toBe(noCapacity.parse('1')._unsafeUnwrap());
  });

  it('preserves parser errors without retaining failed parses', () => {
    const cache = new FormulaParseCache();
    const first = cache.parse('SUM(')._unsafeUnwrapErr();
    expect(cache.parse('SUM(')._unsafeUnwrapErr()).toMatchObject({
      code: first.code,
      message: first.message,
    });
    expect(cache.parse('SUM(')._unsafeUnwrapErr()).not.toBe(first);
    expect(parseFormulaExpression('SUM(')._unsafeUnwrapErr()).toMatchObject({
      code: first.code,
      message: first.message,
    });
  });
});
