import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReconnectingSockJS, reconnectDelayMs } from './reconnectingSockJS';

/** Stands in for SockJS: each instance is one connection attempt the test opens and closes by hand. */
const attempts: Array<{
  onopen: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  close: () => void;
}> = [];

vi.mock('sockjs-client', () => ({
  default: vi.fn(function (this: (typeof attempts)[number]) {
    this.onopen = null;
    this.onclose = null;
    this.close = () => undefined;
    attempts.push(this);
  }),
}));

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

describe('ReconnectingSockJS backoff', () => {
  const open = () => attempts.at(-1)!.onopen!({});
  const drop = () => attempts.at(-1)!.onclose!({ code: 1006, reason: '' });
  /** Delay before the next attempt starts, read off the fake clock. */
  const nextDelay = () => {
    const before = attempts.length;
    let waited = 0;
    while (attempts.length === before) {
      vi.advanceTimersByTime(100);
      waited += 100;
    }
    return waited;
  };

  beforeEach(() => {
    attempts.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps backing off when connections open and drop straight away', () => {
    const socket = new ReconnectingSockJS('http://localhost/socket', { random: () => 1 });
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      open();
      vi.advanceTimersByTime(3_000);
      drop();
      delays.push(nextDelay());
    }
    // 1000 * 1.5^n, read in 100ms steps
    expect(delays).toEqual([1000, 1500, 2300, 3400]);
    socket.destroy();
  });

  it('starts over once a connection has stayed up for stableConnectionMs', () => {
    const socket = new ReconnectingSockJS('http://localhost/socket', { random: () => 1 });
    for (let i = 0; i < 3; i++) {
      open();
      drop();
      nextDelay();
    }
    open();
    vi.advanceTimersByTime(30_000);
    drop();
    expect(nextDelay()).toBe(1000);
    socket.destroy();
  });
});
