import { describe, expect, it } from 'vitest';

import { ensureTableQueryObservationSchema, ensureTableQueryOpsSchema } from './schema';

describe('ensureTableQueryOpsSchema', () => {
  it('exports separate ops and observation schema entrypoints', () => {
    expect(typeof ensureTableQueryOpsSchema).toBe('function');
    expect(typeof ensureTableQueryObservationSchema).toBe('function');
  });
});
