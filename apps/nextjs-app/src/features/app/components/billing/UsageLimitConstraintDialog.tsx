import { UsageLimitModalType } from '@teable/sdk/components/billing/store';
import { UsageLimitReasonBlock } from '@teable/sdk/components/billing/UsageLimitReasonBlock';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';

interface IUsageLimitConstraintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modalType: UsageLimitModalType;
  /**
   * `false` = confirmed non-owner, who is told the owner manages the plan.
   * `true` or `undefined` (role not resolved yet) keeps the plain limit copy.
   */
  isSpaceOwner?: boolean;
  /**
   * Self-hosted flavor of HTTP 460: the instance license's user cap, handled by an
   * administrator, not a seat count of the space.
   */
  instanceUserCap?: boolean;
}

const COPY_BY_TYPE = {
  [UsageLimitModalType.Upgrade]: {
    title: 'mobileEmbed.limitReachedTitle',
    description: 'mobileEmbed.limitReachedDescription',
  },
  [UsageLimitModalType.CreditInsufficient]: {
    title: 'mobileEmbed.creditsExhaustedTitle',
    description: 'mobileEmbed.creditsExhaustedDescription',
  },
  [UsageLimitModalType.User]: {
    title: 'mobileEmbed.seatLimitTitle',
    description: 'mobileEmbed.seatLimitDescription',
  },
} as const;

// Self-hosted HTTP 460: the instance license's user cap, an administrator matter.
const INSTANCE_USER_CAP_COPY = {
  title: 'mobileEmbed.userCapTitle',
  description: 'mobileEmbed.userCapDescription',
} as const;

/**
 * Limit-hit dialog for the native mobile app's WebView (embed mode): it names
 * the limit and shows the usage meter, and nothing else. No plan cards, no
 * checkout, no pricing link, no "upgrade" wording — App Store Review Guideline
 * 3.1.3 forbids steering to a purchase outside in-app purchase, and Teable
 * sells plans on the web. Both the community and the enterprise
 * `UsageLimitModal` swap to this when `useUpgradeCtaEnabled` is false.
 */
export const UsageLimitConstraintDialog = (props: IUsageLimitConstraintDialogProps) => {
  const { open, onOpenChange, modalType, isSpaceOwner, instanceUserCap } = props;
  const { t } = useTranslation('common');
  const copy = instanceUserCap ? INSTANCE_USER_CAP_COPY : COPY_BY_TYPE[modalType];
  const description =
    isSpaceOwner === false && !instanceUserCap
      ? t('mobileEmbed.ownerManagesPlan')
      : t(copy.description);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t(copy.title)}</DialogTitle>
          {/* Neutral meter only: no backend sentence, no `detailHref` to the billing page.
              Renders nothing without a captured reason (e.g. the self-hosted user cap). */}
          <UsageLimitReasonBlock neutral />
          <DialogDescription className="pt-1">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t('actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
