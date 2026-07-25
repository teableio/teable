import { describe, expect, it } from 'vitest';

import { ensureTableQueryOpsSchema } from './schema';

describe('ensureTableQueryOpsSchema', () => {
  it('is exported as the schema entrypoint', () => {
    expect(typeof ensureTableQueryOpsSchema).toBe('function');
  });
});
