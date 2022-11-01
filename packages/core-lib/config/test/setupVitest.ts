import { vi } from 'vitest';

const jestCompatOverride = {
  fn: vi.fn,
  spyOn: vi.spyOn,
};

(global as Record<'jest', unknown>).jest = jestCompatOverride;
