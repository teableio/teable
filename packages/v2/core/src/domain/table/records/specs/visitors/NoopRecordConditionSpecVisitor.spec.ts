import { describe, expect, it } from 'vitest';

import { NoopRecordConditionSpecVisitor } from './NoopRecordConditionSpecVisitor';

describe('NoopRecordConditionSpecVisitor', () => {
  it('returns ok for all visit methods', () => {
    const visitor = new NoopRecordConditionSpecVisitor();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(visitor)).filter((name) =>
      name.startsWith('visit')
    );

    expect(methods.length).toBeGreaterThan(0);

    for (const method of methods) {
      const result = (visitor as unknown as Record<string, (spec: unknown) => { isOk(): boolean }>)[
        method
      ]({});
      expect(result.isOk()).toBe(true);
    }
  });
});
