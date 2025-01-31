import { User, Users } from '@teable/icons';
import { useTablePermission, usePersonalView, useView } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';
import { Fragment, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { ToolBarButton } from '../ToolBarButton';

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

  const toggleViewStatus = () => {
    if (isPersonalView) {
      !hasSyncPermission || view?.isLocked ? closePersonalView?.() : setIsConfirmOpen(true);
    } else {
      openPersonalView?.();
    }
  };

  return (
    <Fragment>
      <ToolBarButton
        isActive={isPersonalView}
        text={
          isPersonalView
            ? t('table:toolbar.others.personalView.personal')
            : t('table:toolbar.others.personalView.collaborative')
        }
        className={buttonClassName}
        textClassName={textClassName}
        onClick={toggleViewStatus}
      >
        {isPersonalView ? <User className="size-4" /> : <Users className="size-4" />}
      </ToolBarButton>
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
        onCancel={() => {
          closePersonalView?.();
          setIsConfirmOpen(false);
        }}
        onConfirm={async () => {
          await syncViewProperties?.();
          closePersonalView?.();
          setIsConfirmOpen(false);
        }}
      />
    </Fragment>
  );
};
