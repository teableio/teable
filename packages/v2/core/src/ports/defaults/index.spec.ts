import { describe, expect, it } from 'vitest';

import * as defaults from './index';

describe('ports/defaults index', () => {
  it('re-exports noop implementations', () => {
    expect(defaults).toHaveProperty('NoopEventBus');
    expect(defaults).toHaveProperty('NoopLogger');
    expect(defaults).toHaveProperty('NoopRealtimeEngine');
    expect(defaults).toHaveProperty('NoopUndoRedoStore');
    expect(defaults).toHaveProperty('NoopUnitOfWork');
  });
});
