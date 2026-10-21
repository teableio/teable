import { BillingProductLevel } from '@teable/openapi';
import { act, renderHook } from '@testing-library/react';
import { useUpgradeCtaEnabled } from '../../hooks/useUpgradeCtaEnabled';
import { useUpgradeAction } from './UpgradeWrapper';

const { openModal, toastWarning } = vi.hoisted(() => ({
  openModal: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
}));

vi.mock('@teable/sdk/hooks', async () => {
  const { Role } = await import('@teable/core');
  return {
    useBase: () => ({ id: 'bsexxx', spaceId: 'spcxxx', role: Role.Owner }),
    useIsReadOnlyPreview: () => false,
  };
});

vi.mock('@teable/sdk/components/billing/store', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useUsageLimitModalStore: () => ({ openModal }),
}));

vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({
  toast: { warning: toastWarning, error: vi.fn() },
}));

vi.mock('../../hooks/useBaseUsage', () => ({ useBaseUsage: () => undefined }));
vi.mock('../../hooks/useBillingLevel', async () => {
  const { BillingProductLevel } = await import('@teable/openapi');
  return { useBillingLevel: () => BillingProductLevel.Free };
});
vi.mock('../../hooks/useBillingLevelConfig', () => ({
  useBillingLevelConfig: () => ({ name: 'Pro', description: 'pro', upgradeTagCls: 'tag' }),
  useAppSumoTierConfig: () => undefined,
}));
vi.mock('../../hooks/useIsCloud', () => ({ useIsCloud: () => true }));
vi.mock('../../hooks/useIsCommunity', () => ({ useIsCommunity: () => false }));
vi.mock('../../hooks/useIsEE', () => ({ useIsEE: () => false }));
vi.mock('../../hooks/useUpgradeCtaEnabled', () => ({ useUpgradeCtaEnabled: vi.fn() }));

const renderAction = () =>
  renderHook(() => useUpgradeAction({ targetBillingLevel: BillingProductLevel.Pro }));

describe('useUpgradeAction', () => {
  beforeEach(() => {
    openModal.mockClear();
    toastWarning.mockClear();
  });

  it('renders the upgrade badge and opens the paywall on the regular web app', () => {
    vi.mocked(useUpgradeCtaEnabled).mockReturnValue(true);
    const { result } = renderAction();
    expect(result.current.needsUpgrade).toBe(true);
    expect(result.current.badge).not.toBeNull();
    act(() => result.current.handleUpgradeClick());
    expect(openModal).toHaveBeenCalledTimes(1);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('keeps the feature gated but only states the constraint inside the native mobile WebView', () => {
    vi.mocked(useUpgradeCtaEnabled).mockReturnValue(false);
    const { result } = renderAction();
    expect(result.current.needsUpgrade).toBe(true);
    expect(result.current.upgradeCtaEnabled).toBe(false);
    expect(result.current.badge).toBeNull();
    act(() => result.current.handleUpgradeClick());
    expect(openModal).not.toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith('billing.unavailableInPlanTips');
  });
});
