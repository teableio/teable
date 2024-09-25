import { HelpCircle, Plus } from '@teable/icons';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useRef } from 'react';
import { useClickAway } from 'react-use';
import { tableConfig } from '@/features/i18n/table.config';

interface IPrefillingRowContainerProps {
  style?: React.CSSProperties;
  children: React.ReactNode;
  isLoading?: boolean;
  onCancel?: () => void;
  onClickOutside?: () => void;
}

export const PrefillingRowContainer = (props: IPrefillingRowContainerProps) => {
  const { style, children, isLoading, onCancel, onClickOutside } = props;
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
      <div className="absolute left-0 top-[-32px] flex h-8 items-center rounded-ss-lg bg-violet-500 px-2 py-1 text-background dark:border-violet-700">
        {isLoading ? <Spin className="mr-1 size-4" /> : <Plus className="mr-1" />}
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
        <Button
          size="xs"
          variant="secondary"
          onClick={() => onCancel?.()}
          className="ml-2 h-5 rounded-sm"
        >
          {t('actions.cancel')}
        </Button>
      </div>
      {children}
    </div>
  );
};
