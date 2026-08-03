import { nullsToUndefined, nullsToUndefinedShallow } from '../';

describe('nullsToUndefined', () => {
  it('turns a top level null or undefined into undefined', () => {
    expect(nullsToUndefined(null)).toBeUndefined();
    expect(nullsToUndefined(undefined)).toBeUndefined();
  });

  it('leaves primitives untouched', () => {
    expect(nullsToUndefined('hello')).toBe('hello');
    expect(nullsToUndefined(0)).toBe(0);
    expect(nullsToUndefined(false)).toBe(false);
  });

  it('replaces null values inside a plain object', () => {
    const result = nullsToUndefined({ a: 1, b: null });
    expect(result.a).toBe(1);
    expect(result.b).toBeUndefined();
  });

  it('recurses into nested plain objects', () => {
    const result = nullsToUndefined({ outer: { inner: null, kept: 2 } });
    expect(result.outer.inner).toBeUndefined();
    expect(result.outer.kept).toBe(2);
  });

  it('does not recurse into arrays, so their nulls survive', () => {
    const result = nullsToUndefined({ list: [1, null, 2] });
    expect(result.list).toEqual([1, null, 2]);
  });

  it('mutates and returns the same object reference', () => {
    const input = { a: null };
    expect(nullsToUndefined(input)).toBe(input);
  });
});

describe('nullsToUndefinedShallow', () => {
  it('turns a top level null into undefined', () => {
    expect(nullsToUndefinedShallow(null)).toBeUndefined();
  });

  it('replaces only the top level null values', () => {
    const result = nullsToUndefinedShallow({ a: null, b: 2 });
    expect(result.a).toBeUndefined();
    expect(result.b).toBe(2);
  });

  it('does not recurse, so a nested null stays null', () => {
    const result = nullsToUndefinedShallow({ nested: { inner: null } });
    expect(result.nested).toEqual({ inner: null });
  });
});
