import type { BillingProductLevel } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import type { AppSumoTier } from '../../hooks/useBillingLevelConfig';
import { useAppSumoTierConfig, useBillingLevelConfig } from '../../hooks/useBillingLevelConfig';

interface ILevelProps {
  level?: BillingProductLevel;
  appSumoTier?: AppSumoTier;
}

export const Level = (props: ILevelProps) => {
  const { level, appSumoTier } = props;
  const levelConfig = useBillingLevelConfig(level);
  const appSumoConfig = useAppSumoTierConfig(appSumoTier);

  const { name, tagCls } = appSumoConfig ?? levelConfig;

  return (
    <div
      className={cn('shrink-0 rounded px-1.5 h-5 flex items-center justify-center text-xs', tagCls)}
    >
      {name}
    </div>
  );
};
