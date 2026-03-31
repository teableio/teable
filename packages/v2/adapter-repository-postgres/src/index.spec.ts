import { describe, expect, it } from 'vitest';

import * as adapter from './index';

describe('index exports', () => {
  it('re-exports the public adapter entry points', () => {
    expect(adapter.v2PostgresStateAdapterConfigSchema).toBeDefined();
    expect(adapter.v2PostgresStateTokens).toBeDefined();
    expect(adapter.ensureV1MetaSchema).toBeTypeOf('function');
    expect(adapter.registerV2PostgresStateAdapter).toBeTypeOf('function');
    expect(adapter.PostgresTableRepository).toBeTypeOf('function');
  });
});
