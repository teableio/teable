import { describe, expect, it } from 'vitest';

import { SingleLineTextShowAs } from './SingleLineTextShowAs';

describe('SingleLineTextShowAs', () => {
  it('accepts supported showAs types', () => {
    expect(SingleLineTextShowAs.create({ type: 'url' }).isOk()).toBe(true);
    expect(SingleLineTextShowAs.create({ type: 'email' }).isOk()).toBe(true);
    expect(SingleLineTextShowAs.create({ type: 'phone' }).isOk()).toBe(true);
  });

  it('rejects unsupported showAs types', () => {
    expect(SingleLineTextShowAs.create({ type: 'link' }).isErr()).toBe(true);
  });
});
