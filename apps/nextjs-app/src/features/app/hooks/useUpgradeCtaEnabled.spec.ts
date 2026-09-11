import { renderHook } from '@testing-library/react';
import { useEmbedMode } from './useEmbedMode';
import { useUpgradeCtaEnabled } from './useUpgradeCtaEnabled';

vi.mock('./useEmbedMode', () => ({
  useEmbedMode: vi.fn(),
}));

describe('useUpgradeCtaEnabled', () => {
  it('allows upgrade CTAs on the regular web app', () => {
    vi.mocked(useEmbedMode).mockReturnValue(false);
    expect(renderHook(() => useUpgradeCtaEnabled()).result.current).toBe(true);
  });

  it('forbids upgrade CTAs inside the native mobile WebView', () => {
    vi.mocked(useEmbedMode).mockReturnValue(true);
    expect(renderHook(() => useUpgradeCtaEnabled()).result.current).toBe(false);
  });
});
