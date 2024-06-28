import type { BillingProductLevel } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useBillingLevelConfig } from '../../hooks/useBillingLevelConfig';

interface ILevelProps {
  level?: BillingProductLevel;
}

export const Level = (props: ILevelProps) => {
  const { level } = props;
  const { name, tagCls } = useBillingLevelConfig(level);

  return <div className={cn('shrink-0 rounded px-2 py-px text-[13px]', tagCls)}>{name}</div>;
};
