import { render, screen } from '@testing-library/react';
import { useUpgradeCtaEnabled } from '../../hooks/useUpgradeCtaEnabled';
import { LevelWithUpgrade } from './LevelWithUpgrade';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../../hooks/useBillingLevelConfig', () => ({
  useBillingLevelConfig: () => ({ name: 'Free', description: 'free plan' }),
  useAppSumoTierConfig: () => undefined,
}));

vi.mock('../../hooks/useUpgradeCtaEnabled', () => ({
  useUpgradeCtaEnabled: vi.fn(),
}));

describe('LevelWithUpgrade', () => {
  it('offers the owner an Upgrade button on the regular web app', () => {
    vi.mocked(useUpgradeCtaEnabled).mockReturnValue(true);
    render(<LevelWithUpgrade spaceId="spcxxx" withUpgrade />);
    expect(screen.getByText('actions.upgrade')).toBeInTheDocument();
  });

  it('keeps the plan badge but drops the Upgrade button inside the native mobile WebView', () => {
    vi.mocked(useUpgradeCtaEnabled).mockReturnValue(false);
    render(<LevelWithUpgrade spaceId="spcxxx" withUpgrade />);
    // `Level` prints the configured plan name (mocked as 'Free').
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.queryByText('actions.upgrade')).toBeNull();
  });
});
