import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnection } from './use-connection';
import { useActionListener } from './use-presence';

vi.mock('./use-connection', () => ({ useConnection: vi.fn() }));

const mockedUseConnection = vi.mocked(useConnection);

class FakePresence {
  subscribed = true;
  wantSubscribe = true;
  private readonly listeners = new Set<(id: string, data: unknown) => void>();

  addListener = vi.fn((_event: string, listener: (id: string, data: unknown) => void) => {
    this.listeners.add(listener);
  });
  removeListener = vi.fn((_event: string, listener: (id: string, data: unknown) => void) => {
    this.listeners.delete(listener);
  });
  listenerCount = vi.fn(() => this.listeners.size);
  subscribe = vi.fn();
  unsubscribe = vi.fn();
  destroy = vi.fn();

  emitReceive(id: string, data: unknown) {
    for (const listener of this.listeners) {
      listener(id, data);
    }
  }
}

describe('useActionListener', () => {
  it('ignores a presence removal payload and still delivers action batches', () => {
    const presence = new FakePresence();
    mockedUseConnection.mockReturnValue({
      connection: { getPresence: () => presence },
    } as never);

    const callback = vi.fn();
    renderHook(() => useActionListener('tblTest', ['computeActivityChanged'], callback));

    expect(presence.addListener).toHaveBeenCalledWith('receive', expect.any(Function));

    presence.emitReceive('__action_trigger_tblTest', null);
    expect(callback).not.toHaveBeenCalled();

    presence.emitReceive('__action_trigger_tblTest', [{ actionKey: 'computeActivityChanged' }]);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('computeActivityChanged', undefined);
  });
});
