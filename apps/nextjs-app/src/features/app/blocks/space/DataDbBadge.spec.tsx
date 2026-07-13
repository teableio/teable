import { render, screen } from '@testing-library/react';
import { LevelWithUpgrade } from '../../components/billing/LevelWithUpgrade';
import { DataDbBadge } from './DataDbBadge';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../../hooks/useBillingLevelConfig', () => ({
  useBillingLevelConfig: () => ({ name: 'Business', description: 'business plan' }),
  useAppSumoTierConfig: () => undefined,
}));

describe('DataDbBadge', () => {
  it('renders the dedicated badge with tooltip for byodb spaces', () => {
    render(<DataDbBadge dataDb={{ mode: 'byodb', state: 'ready' } as never} />);
    const badge = screen.getByText('space:dataDb.badge.label');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('font-normal');
    expect(badge.className).toContain('border-none');
  });

  it('renders nothing for default spaces', () => {
    const { container } = render(<DataDbBadge dataDb={{ mode: 'default' } as never} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders inside LevelWithUpgrade right after the plan badge', () => {
    render(
      <LevelWithUpgrade spaceId="spcxxx" withUpgrade>
        <DataDbBadge dataDb={{ mode: 'byodb', state: 'ready' } as never} />
      </LevelWithUpgrade>
    );
    expect(screen.getByText('space:dataDb.badge.label')).toBeInTheDocument();
    expect(screen.getByText('actions.upgrade')).toBeInTheDocument();
  });
});
