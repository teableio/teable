import { FieldType } from '@teable/core';
import { UsageFeatureLimit } from '@teable/openapi';
import { useState } from 'react';
import { render, screen, userEvent } from '@/test-utils';
import { PeriodicRefreshSetting } from './PeriodicRefreshSetting';

const { useBaseUsage } = vi.hoisted(() => ({ useBaseUsage: vi.fn() }));

vi.mock('@/features/app/hooks/useBaseUsage', () => ({ useBaseUsage }));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => true }));
vi.mock('@/features/app/hooks/useIsEE', () => ({ useIsEE: () => false }));
vi.mock('next-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const field = {
  type: FieldType.Formula,
  options: { expression: 'NOW()' },
  periodicRefresh: {
    supported: true,
    enabled: true,
    cadence: 'day' as const,
    timeZone: 'UTC',
    lastStatus: 'paused_plan_downgrade' as const,
  },
};
const pausedLabel = 'table:field.editor.periodicRefresh.statusPausedDowngrade';
const upgradeTip = 'table:field.editor.periodicRefresh.upgradeTip';

const Editor = () => {
  const [enabled, setEnabled] = useState(true);
  return (
    <PeriodicRefreshSetting
      field={field}
      periodicRefreshEnabled={enabled}
      onPeriodicRefreshEnabledChange={setEnabled}
    />
  );
};

describe('PeriodicRefreshSetting', () => {
  it('shows the pause after downgrade and allows turning refresh off', async () => {
    useBaseUsage.mockReturnValue({
      limit: { [UsageFeatureLimit.PeriodicFieldRefreshEnable]: false },
    });
    render(<Editor />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByText(pausedLabel)).toBeInTheDocument();
    expect(screen.queryByText(upgradeTip)).not.toBeInTheDocument();
    expect(
      screen.getByText('table:field.editor.periodicRefresh.nowPrecisionNotice')
    ).toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.queryByText(pausedLabel)).not.toBeInTheDocument();
    expect(screen.getByText(upgradeTip)).toBeInTheDocument();
  });

  it('hides the stale pause as soon as the plan regains entitlement', () => {
    useBaseUsage.mockReturnValue({
      limit: { [UsageFeatureLimit.PeriodicFieldRefreshEnable]: true },
    });
    render(<Editor />);

    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.queryByText(pausedLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(upgradeTip)).not.toBeInTheDocument();
  });
});
