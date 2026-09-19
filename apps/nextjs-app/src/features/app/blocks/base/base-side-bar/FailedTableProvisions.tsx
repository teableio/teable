import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cleanupFailedTableProvision,
  getFailedTableProvisions,
  SUPPORTEDTYPE,
} from '@teable/openapi';
import { useBase, useBasePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { TableImport } from '@overridable/TableImport';

/** Failed tables may lack a view or base-node; render them without opening record paths. */
export const FailedTableProvisions = () => {
  const base = useBase();
  const permission = useBasePermission();
  const { t } = useTranslation(['table']);
  const client = useQueryClient();
  const [confirmId, setConfirmId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const key = ['failed-table-provisions', base.id];
  const { data: tables } = useQuery({
    queryKey: key,
    queryFn: async () => (await getFailedTableProvisions(base.id)).data,
    enabled: base.v2Status?.useV2 === true,
    refetchInterval: 30_000,
  });
  if (!tables?.length) return null;
  return (
    <div className="space-y-2 px-3 text-sm">
      <p className="font-medium">{t('table:failedProvision.title')}</p>
      {tables.map((table) => (
        <details key={table.id} className="rounded border p-2">
          <summary className="cursor-pointer truncate">{table.name}</summary>
          <p className="py-2 text-muted-foreground">{t('table:failedProvision.reason')}</p>
          {permission?.['table|create'] && (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {t('table:failedProvision.reimport')}
            </Button>
          )}
          {permission?.['table|delete'] && table.operationType === 'table.import' && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                if (confirmId !== table.id) {
                  setConfirmId(table.id);
                  return;
                }
                setBusy(true);
                setError(undefined);
                try {
                  await cleanupFailedTableProvision(base.id, table.id);
                  await client.invalidateQueries({ queryKey: key });
                  setConfirmId(undefined);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : t('table:failedProvision.cleanupFailed')
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t(
                confirmId === table.id
                  ? 'table:failedProvision.confirmCleanup'
                  : 'table:failedProvision.cleanup'
              )}
            </Button>
          )}
        </details>
      ))}
      {error && <p role="alert">{error}</p>}
      {importOpen && <TableImport fileType={SUPPORTEDTYPE.CSV} open onOpenChange={setImportOpen} />}
    </div>
  );
};
