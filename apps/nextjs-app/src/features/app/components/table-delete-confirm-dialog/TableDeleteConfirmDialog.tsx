import { useBaseId } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { useTranslation } from 'next-i18next';
import { LoginAppWarning } from '../LoginAppWarning';
import { OperationPreviewPanel, useOperationPreview } from '../operation-preview';

export interface TableDeleteConfirmDialogProps {
  open: boolean;
  tableId: string;
  tableName: string;
  isDeleting?: boolean;
  mode?: 'soft' | 'permanent';
  loginApps?: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const TableDeleteConfirmDialog = (props: TableDeleteConfirmDialogProps) => {
  const {
    open,
    tableId,
    tableName,
    mode = 'soft',
    isDeleting,
    loginApps,
    onOpenChange,
    onConfirm,
  } = props;
  const { t } = useTranslation(['common', 'table']);
  const baseId = useBaseId();
  const preview = useOperationPreview(
    { operation: 'table.delete', input: { baseId, tableId, mode }, options: { detail: 'full' } },
    open && Boolean(baseId && tableId)
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="flex max-h-[560px] max-w-xl flex-col"
      title={t('table:table.deleteConfirm', { tableName })}
      content={
        <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm">
          {loginApps && loginApps.length > 0 && (
            <LoginAppWarning message={t('table:table.loginDeleteWarning')} apps={loginApps} />
          )}
          <OperationPreviewPanel
            preview={preview.data}
            error={preview.error}
            isLoading={preview.isPending || preview.isFetching}
            onRetry={() => void preview.refetch()}
          />
        </div>
      }
      cancelText={t('common:actions.cancel')}
      confirmText={mode === 'permanent' ? t('common:actions.delete') : t('common:trash.addToTrash')}
      confirmLoading={isDeleting}
      confirmDisabled={isDeleting || !preview.canConfirm}
      confirmButtonVariant={mode === 'permanent' ? 'destructive' : 'default'}
      onCancel={() => onOpenChange(false)}
      onConfirm={() => {
        if (preview.canConfirm && !isDeleting) onConfirm();
      }}
    />
  );
};
