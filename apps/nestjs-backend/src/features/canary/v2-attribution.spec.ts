import { describe, expect, it, vi } from 'vitest';
import { markUnsupportedV2FeatureFallback } from './v2-attribution';

describe('markUnsupportedV2FeatureFallback', () => {
  it('stamps useV2 false and unsupported_feature when the request was routed to v2', () => {
    const cls = {
      get: vi.fn((key: string) => (key === 'useV2' ? true : undefined)),
      set: vi.fn(),
    };

    markUnsupportedV2FeatureFallback(cls as never);

    expect(cls.set).toHaveBeenCalledWith('useV2', false);
    expect(cls.set).toHaveBeenCalledWith('v2Reason', 'unsupported_feature');
  });

  it('does not overwrite attribution that was already v1', () => {
    const cls = {
      get: vi.fn(() => false),
      set: vi.fn(),
    };

    markUnsupportedV2FeatureFallback(cls as never);

    expect(cls.set).not.toHaveBeenCalled();
  });
});
