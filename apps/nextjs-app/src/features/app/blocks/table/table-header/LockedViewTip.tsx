import { X } from '@teable/icons';
import { usePersonalView } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useLockedViewTipStore } from '../store';

export const LockedViewTip = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { setVisible } = useLockedViewTipStore();
  const { openPersonalView } = usePersonalView();

  return (
    <div className="w-full @container/locked-view-tip">
      <div className="relative flex w-full items-center justify-between gap-4 px-4 py-1.5 text-xs text-gray-500 duration-500 animate-in fade-in @3xl/locked-view-tip:justify-center dark:text-gray-400">
        <div className="relative">{t('table:view.locked.tip')}</div>
        <div className="flex @3xl/locked-view-tip:absolute @3xl/locked-view-tip:right-2 @3xl/locked-view-tip:top-1/2 @3xl/locked-view-tip:mr-0 @3xl/locked-view-tip:-translate-y-1/2">
          <Button
            size="xs"
            className="flex h-5"
            onClick={() => {
              openPersonalView();
              setVisible(false);
            }}
          >
            {t('table:view.action.enable')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="ml-2 flex size-5 p-[2px]"
            onClick={() => setVisible(false)}
          >
            <X className="size-4 shrink-0" />
          </Button>
        </div>
      </div>
    </div>
  );
};
