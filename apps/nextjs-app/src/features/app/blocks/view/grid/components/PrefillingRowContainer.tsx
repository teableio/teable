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
  onAddRow?: () => void;
}

export const PrefillingRowContainer = (props: IPrefillingRowContainerProps) => {
  const { style, children, isLoading, onCancel, onClickOutside, onAddRow } = props;
  const prefillingGridContainerRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  useClickAway(prefillingGridContainerRef, () => {
    onClickOutside?.();
  });

  return (
    <div
      ref={prefillingGridContainerRef}
      className="absolute left-0 w-full border-t-2 border-primary"
      style={style}
    >
      <div className="absolute left-0 top-[-32px] flex h-8 items-center rounded-t-lg bg-primary px-2 py-1 text-background">
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
      <div
        className="flex h-8 w-full select-none items-center border-b-2 border-t border-b-primary border-t-gray-200 bg-background pl-[26px]"
        onClick={() => onAddRow?.()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onAddRow?.();
          }
        }}
      >
        <Plus className="size-5 text-muted-foreground" />
      </div>
    </div>
  );
};
