import { UsageLimitModalType } from '@teable/sdk/components/billing/store';
import { render, screen } from '@testing-library/react';
import { UsageLimitConstraintDialog } from './UsageLimitConstraintDialog';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@teable/sdk/components/billing/UsageLimitReasonBlock', () => ({
  UsageLimitReasonBlock: ({ neutral }: { neutral?: boolean }) => (
    <div>{neutral ? 'reason-block-neutral' : 'reason-block'}</div>
  ),
}));

const renderDialog = (props: Partial<Parameters<typeof UsageLimitConstraintDialog>[0]> = {}) =>
  render(
    <UsageLimitConstraintDialog
      open
      onOpenChange={vi.fn()}
      modalType={UsageLimitModalType.Upgrade}
      {...props}
    />
  );

describe('UsageLimitConstraintDialog', () => {
  it('states a plan limit with the neutral usage meter and a close button only', () => {
    renderDialog();
    expect(screen.getByText('mobileEmbed.limitReachedTitle')).toBeInTheDocument();
    expect(screen.getByText('mobileEmbed.limitReachedDescription')).toBeInTheDocument();
    // Neutral: the backend's sentence (which may pitch an upgrade) is never shown.
    expect(screen.getByText('reason-block-neutral')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actions.close' })).toBeInTheDocument();
    expect(screen.queryByText('actions.upgrade')).toBeNull();
  });

  it('uses the credit copy when AI credits ran out', () => {
    renderDialog({ modalType: UsageLimitModalType.CreditInsufficient });
    expect(screen.getByText('mobileEmbed.creditsExhaustedTitle')).toBeInTheDocument();
    expect(screen.getByText('mobileEmbed.creditsExhaustedDescription')).toBeInTheDocument();
  });

  it('keeps the seat meter for a cloud seat limit', () => {
    renderDialog({ modalType: UsageLimitModalType.User });
    expect(screen.getByText('mobileEmbed.seatLimitTitle')).toBeInTheDocument();
    expect(screen.getByText('mobileEmbed.seatLimitDescription')).toBeInTheDocument();
    expect(screen.getByText('reason-block-neutral')).toBeInTheDocument();
  });

  it('uses the instance user-cap copy for a self-hosted 460, even for non-owners', () => {
    renderDialog({
      modalType: UsageLimitModalType.User,
      instanceUserCap: true,
      isSpaceOwner: false,
    });
    expect(screen.getByText('mobileEmbed.userCapTitle')).toBeInTheDocument();
    expect(screen.getByText('mobileEmbed.userCapDescription')).toBeInTheDocument();
    expect(screen.queryByText('mobileEmbed.seatLimitTitle')).toBeNull();
    expect(screen.queryByText('mobileEmbed.ownerManagesPlan')).toBeNull();
  });

  it('tells confirmed non-owners that the owner manages the plan', () => {
    renderDialog({ isSpaceOwner: false });
    expect(screen.getByText('mobileEmbed.ownerManagesPlan')).toBeInTheDocument();
    expect(screen.queryByText('mobileEmbed.limitReachedDescription')).toBeNull();
  });

  it('keeps the plain copy while the role is still unknown', () => {
    renderDialog({ isSpaceOwner: undefined });
    expect(screen.getByText('mobileEmbed.limitReachedDescription')).toBeInTheDocument();
  });
});
