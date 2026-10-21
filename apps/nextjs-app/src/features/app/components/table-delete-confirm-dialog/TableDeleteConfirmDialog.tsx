import { useQuery } from '@tanstack/react-query';
import { getTableDeleteReferences } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { ConfirmDialog, Spin } from '@teable/ui-lib/base';
import { Trans, useTranslation } from 'next-i18next';
import { AffectedFieldsList } from '../field-setting/field-delete-confirm-dialog/AffectedFieldsList';
import type { AffectedItem } from '../field-setting/field-delete-confirm-dialog/types';
import { LoginAppWarning } from '../LoginAppWarning';

export interface TableDeleteConfirmDialogProps {
  open: boolean;
  tableId: string;
  tableName: string;
  isDeleting?: boolean;
  loginApps?: Array<{ id: string; name: string }>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const TableDeleteConfirmDialog = (props: TableDeleteConfirmDialogProps) => {
  const { open, tableId, tableName, isDeleting, loginApps, onOpenChange, onConfirm } = props;
  const { t } = useTranslation(['common', 'table']);
  const baseId = useBaseId();

  const { data, isLoading } = useQuery({
    queryKey: ['table-delete-references', baseId, tableId],
    queryFn: () => getTableDeleteReferences(baseId as string, tableId).then((res) => res.data),
    enabled: open && Boolean(baseId && tableId),
    refetchOnWindowFocus: false,
  });

  const affectedItems: AffectedItem[] = (data?.dependentFields ?? []).map((field) => ({
    id: field.id,
    name: field.name,
    itemType: 'field',
    type: field.type,
    source: field.source,
  }));

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
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Spin />
            </div>
          ) : affectedItems.length > 0 ? (
            <>
              <p className="shrink-0 text-foreground">
                <Trans
                  ns="table"
                  i18nKey="table.deleteWithDependencies"
                  components={{ b: <b /> }}
                  values={{ tableName }}
                />
              </p>
              <AffectedFieldsList items={affectedItems} />
              <p className="shrink-0 text-muted-foreground">{t('common:trash.description')}</p>
            </>
          ) : (
            <>
              <p>{t('table:table.deleteTip1')}</p>
              <p>{t('common:trash.description')}</p>
            </>
          )}
        </div>
      }
      cancelText={t('common:actions.cancel')}
      confirmText={t('common:trash.addToTrash')}
      confirmLoading={isDeleting}
      confirmDisabled={isDeleting || isLoading}
      onCancel={() => onOpenChange(false)}
      onConfirm={onConfirm}
    />
  );
};
