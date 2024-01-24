import { ArrowUpDown, HelpCircle } from '@teable-group/icons';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib/shadcn';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

interface IPrefillingRowContainerProps {
  style?: React.CSSProperties;
  children: React.ReactNode;
  onClickOutside?: () => void;
}

export const PrefillingRowContainer = (props: IPrefillingRowContainerProps) => {
  const { style, children, onClickOutside } = props;
  const prefillingGridContainerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  useClickAway(prefillingGridContainerRef, () => {
    onClickOutside?.();
  });

  return (
    <div
      ref={prefillingGridContainerRef}
      className="absolute left-0 w-full border-y-2 border-violet-500 dark:border-violet-700"
      style={style}
    >
      <div className="absolute left-0 top-[-24px] flex h-6 items-center rounded-ss-lg bg-violet-500 px-2 py-1 text-background dark:border-violet-700">
        <ArrowUpDown className="mr-1" />
        <span className="text-[13px]">{t('table:grid.prefillingRowTitle')}</span>
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <span>
                <HelpCircle className="ml-1" />
              </span>
            </TooltipTrigger>
            <TooltipContent sideOffset={8}>{t('table:grid.prefillingRowTooltip')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {children}
    </div>
  );
};
