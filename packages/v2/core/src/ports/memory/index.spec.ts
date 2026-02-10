import { describe, expect, it } from 'vitest';

import * as memory from './index';

describe('ports/memory index', () => {
  it('re-exports memory implementations', () => {
    expect(memory).toHaveProperty('AsyncMemoryEventBus');
    expect(memory).toHaveProperty('MemoryCommandBus');
    expect(memory).toHaveProperty('MemoryEventBus');
    expect(memory).toHaveProperty('MemoryQueryBus');
    expect(memory).toHaveProperty('MemoryTableRepository');
    expect(memory).toHaveProperty('MemoryUndoRedoStore');
  });
});
