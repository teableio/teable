import { SubscriptionStatus, BillingProductLevel } from '@teable/openapi';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useBillingLevelConfig } from '../../hooks/useBillingLevelConfig';
import { Level } from './Level';
import { Status } from './Status';

interface ILevelWithUpgradeProps {
  spaceId?: string;
  level?: BillingProductLevel;
  status?: SubscriptionStatus;
  withUpgrade?: boolean;
  organization?: {
    id: string;
    name: string;
  };
}

export const LevelWithUpgrade = (props: ILevelWithUpgradeProps) => {
  const { level, spaceId, withUpgrade, status, organization } = props;
  const isEnterprise = level === BillingProductLevel.Enterprise;
  const { t } = useTranslation('common');
  const { description } = useBillingLevelConfig(level);
  const router = useRouter();

  const onClick = () => {
    if (spaceId == null) return;

    router.push({
      pathname: '/space/[spaceId]/setting/plan',
      query: { spaceId },
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-x-1 text-sm">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Level level={level} />
          </TooltipTrigger>
          <TooltipContent hideWhenDetached={true} sideOffset={8}>
            <p>{description}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {status === SubscriptionStatus.Active && organization?.name && (
        <span className="text-xs text-muted-foreground">{organization.name}</span>
      )}
      <Status status={status} />
      {withUpgrade && !isEnterprise && (
        <Button
          size="xs"
          variant="ghost"
          className="text-violet-500 hover:text-violet-500"
          onClick={onClick}
        >
          {t('actions.upgrade')}
        </Button>
      )}
    </div>
  );
};
