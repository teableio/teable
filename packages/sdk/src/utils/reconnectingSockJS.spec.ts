import { describe, expect, it } from 'vitest';
import { reconnectDelayMs } from './reconnectingSockJS';

describe('reconnectDelayMs', () => {
  it('spreads the first retry across the base interval', () => {
    const options = {
      reconnectInterval: 1000,
      reconnectDecay: 1.5,
      maxReconnectInterval: 30_000,
    };
    expect(reconnectDelayMs(0, { ...options, random: () => 0 })).toBe(0);
    expect(reconnectDelayMs(0, { ...options, random: () => 0.5 })).toBe(500);
    expect(reconnectDelayMs(0, { ...options, random: () => 0.999 })).toBe(999);
  });

  it('caps jittered backoff at the max interval', () => {
    expect(
      reconnectDelayMs(20, {
        reconnectInterval: 1000,
        reconnectDecay: 1.5,
        maxReconnectInterval: 30_000,
        random: () => 1,
      })
    ).toBe(30_000);
  });
});
