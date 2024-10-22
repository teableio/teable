import { ConfirmDialog } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IConfirmNewRecordsProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export interface IConfirmNewRecordsRef {
  setOpen: (val: boolean, count?: number) => void;
}

export const ConfirmNewRecords = forwardRef<IConfirmNewRecordsRef, IConfirmNewRecordsProps>(
  (props, ref) => {
    const { onCancel, onConfirm } = props;
    const [open, setOpen] = useState(false);
    const [count, setCount] = useState(0);
    const { t } = useTranslation(tableConfig.i18nNamespaces);

    useImperativeHandle(ref, () => ({
      setOpen: (val: boolean, count?: number) => {
        setOpen(val);
        setCount(count ?? 0);
      },
    }));

    return (
      <ConfirmDialog
        open={open}
        closeable={false}
        onOpenChange={setOpen}
        title={t('table:pasteNewRecords.title')}
        description={t('table:pasteNewRecords.description', { count })}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
        cancelText={t('common:actions.cancel')}
        confirmText={t('common:actions.confirm')}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
      />
    );
  }
);

ConfirmNewRecords.displayName = 'ConfirmNewRecords';
