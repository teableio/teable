import { describe, expect, it } from 'vitest';

import { FormulaSqlPgBindings } from './FormulaSqlPgBindings';

describe('formula SQL binding reachability', () => {
  it('does not plan an unused expression named only in user text', () => {
    const bindings = new FormulaSqlPgBindings();
    const unused = bindings.bind(`REGEXP_REPLACE('input', '[', '')`);
    const text = `'quoted ''text'' ${unused}'`;
    expect(bindings.render(text)).toBe(text);
  });

  it('retains transitive shared dependencies exactly once', () => {
    const bindings = new FormulaSqlPgBindings();
    const source = bindings.bind('expensive_input()');
    const left = bindings.bind(`(${source} + 1)`);
    const right = bindings.bind(`(${source} * 2)`);
    const rendered = bindings.render(`(${left} + ${right})`);
    expect(rendered.split('expensive_input()')).toHaveLength(2);
    expect(rendered.match(/AS MATERIALIZED/g)).toHaveLength(3);
  });
});
