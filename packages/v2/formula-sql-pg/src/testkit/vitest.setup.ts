import { afterAll, beforeAll, vi } from 'vitest';

const FIXED_NOW = new Date('2024-01-02T00:00:00Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});
