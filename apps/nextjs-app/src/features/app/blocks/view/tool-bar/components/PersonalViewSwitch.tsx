import { useTablePermission, usePersonalView, useView } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import {
  Switch,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IPersonalViewSwitchProps {
  textClassName?: string;
  buttonClassName?: string;
}

export const PersonalViewSwitch = (props: IPersonalViewSwitchProps) => {
  const { textClassName, buttonClassName } = props;
  const view = useView();
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { isPersonalView, openPersonalView, closePersonalView, syncViewProperties } =
    usePersonalView();
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const hasSyncPermission = permission['view|update'];
  const onSwitchChange = (checked: boolean) => {
    if (checked) {
      openPersonalView?.();
      return;
    }

    // turning off personal view
    if (!hasSyncPermission || view?.isLocked) {
      closePersonalView?.();
    } else {
      setIsConfirmOpen(true);
    }
  };

  return (
    <Fragment>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`${buttonClassName ?? ''} flex h-7 cursor-pointer items-center gap-2 whitespace-nowrap pl-1 text-xs`}
            >
              <span>{t('table:toolbar.others.personalView.personal')}</span>
              <Switch
                id="personal-view-switch"
                checked={Boolean(isPersonalView)}
                onCheckedChange={onSwitchChange}
              />
            </div>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>
              {<span>{t('table:toolbar.others.personalView.tip')}</span>}
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </TooltipProvider>
      <ConfirmDialog
        open={Boolean(isConfirmOpen)}
        closeable={true}
        onOpenChange={(val) => {
          if (!val) {
            setIsConfirmOpen(false);
          }
        }}
        title={t('table:toolbar.others.personalView.dialog.title')}
        description={t('table:toolbar.others.personalView.dialog.description')}
        cancelText={t('table:toolbar.others.personalView.dialog.cancelText')}
        confirmText={t('table:toolbar.others.personalView.dialog.confirmText')}
        onConfirm={() => {
          closePersonalView?.();
          setIsConfirmOpen(false);
        }}
        onCancel={async () => {
          await syncViewProperties?.();
          closePersonalView?.();
          setIsConfirmOpen(false);
        }}
      />
    </Fragment>
  );
};
