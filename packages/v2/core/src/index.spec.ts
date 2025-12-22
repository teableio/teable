import { describe, expect, it } from 'vitest';

import * as core from './index';

describe('core index exports', () => {
  it('re-exports key domain and port modules', () => {
    expect(core).toHaveProperty('Table');
    expect(core).toHaveProperty('TableName');
    expect(core).toHaveProperty('FieldName');
    expect(core).toHaveProperty('ViewName');
    expect(core).toHaveProperty('MemoryCommandBus');
    expect(core).toHaveProperty('NoopEventBus');
    expect(core).toHaveProperty('v2CoreTokens');
  });
});
