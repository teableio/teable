import { useMutation, useQueryClient } from '@tanstack/react-query';
import { resetTrashItems, ResourceType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBasePermission, useTableId } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { Fragment, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { TableTrash } from './TableTrash';

interface ITableTrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TableTrashDialog = (props: ITableTrashDialogProps) => {
  const { open, onOpenChange } = props;
  const tableId = useTableId() as string;
  const permission = useBasePermission();
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const [isConfirmVisible, setConfirmVisible] = useState(false);

  const hasResetPermission = permission?.['table|trash_reset'];

  const { mutateAsync: mutateResetTrash } = useMutation({
    mutationFn: () => resetTrashItems({ resourceType: ResourceType.Table, resourceId: tableId }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.getTrashItems(tableId));
      toast.success(t('actions.resetSucceed'));
    },
  });

  return (
    <Fragment>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[90%] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="flex flex-row items-center justify-between gap-x-2 space-y-0 border-b p-4">
            <DialogTitle className="flex items-center">{t('table:tableTrash.title')}</DialogTitle>
            {hasResetPermission && (
              <Button
                size="xs"
                className="mr-8"
                variant="secondary"
                onClick={() => setConfirmVisible(true)}
              >
                {t('trash.resetTrash')}
              </Button>
            )}
          </DialogHeader>
          <TableTrash />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={isConfirmVisible}
        onOpenChange={setConfirmVisible}
        title={t('trash.resetTrashConfirm')}
        cancelText={t('actions.cancel')}
        confirmText={t('actions.confirm')}
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => {
          setConfirmVisible(false);
          mutateResetTrash();
        }}
      />
    </Fragment>
  );
};
