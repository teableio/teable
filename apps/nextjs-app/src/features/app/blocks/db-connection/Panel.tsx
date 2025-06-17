import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Code2, HelpCircle } from '@teable/icons';
import { deleteDbConnection, createDbConnection, BillingProductLevel } from '@teable/openapi';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Trans, useTranslation } from 'next-i18next';
import { Fragment } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { CopyButton } from '../../components/CopyButton';
import { useBaseUsage } from '../../hooks/useBaseUsage';
import { useIsCloud } from '../../hooks/useIsCloud';
import { useDbConnection } from './hooks';

export const DbConnectionPanel = ({ className }: { className?: string }) => {
  const permissions = useBasePermission();
  const baseId = useBaseId() as string;
  const isCloud = useIsCloud();
  const usage = useBaseUsage();
  const queryClient = useQueryClient();
  const { data, dataArray } = useDbConnection();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const maxNumDatabaseConnections = usage?.limit.maxNumDatabaseConnections;
  const hasPermission = permissions?.['base|db_connection'];
  const isUnavailable = isCloud && usage?.level !== BillingProductLevel.Enterprise;

  const mutationCreate = useMutation(createDbConnection, {
    onSuccess: (data) => {
      queryClient.invalidateQueries(['connection', baseId]);
      if (!data.data) {
        toast.error(t('table:connection.createFailed'));
      }
    },
  });

  const mutationDelete = useMutation(deleteDbConnection, {
    onSuccess: () => {
      queryClient.invalidateQueries(['connection', baseId]);
    },
  });

  const content = (
    <div className="flex flex-col gap-4">
      {data ? (
        <>
          <div className="grid gap-2">
            {dataArray.map(({ label, value, display }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {label === 'pass' || label === 'url' ? (
                      <span className="group relative">
                        <span className="group-hover:hidden">{display}</span>
                        <span className="hidden group-hover:inline">{value}</span>
                      </span>
                    ) : (
                      value
                    )}
                  </code>
                  <CopyButton variant="ghost" size="icon" className="size-6" text={value} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="text-sm text-muted-foreground">
              <Trans
                ns="table"
                i18nKey="connection.connectionCountTip"
                components={{ b: <b /> }}
                values={{
                  max: data.connection.max,
                  current: data.connection.current,
                }}
              />
            </div>
            <Button size="sm" variant="link" onClick={() => mutationDelete.mutate(baseId)}>
              {t('common:actions.delete')}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => mutationCreate.mutate(baseId)}>
            {t('common:actions.create')}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Fragment>
      {!isUnavailable || data ? (
        <div className={className}>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Code2 className="size-4" />
              <h2 className="font-semibold">{t('table:connection.title')}</h2>
            </div>
            <Button variant="ghost" size="icon">
              <a
                href={`${t('common:help.mainLink')}/api-doc/sql-query`}
                target="_blank"
                rel="noreferrer"
              >
                <HelpCircle className="size-4" />
              </a>
            </Button>
          </div>
          {isUnavailable && (
            <p className="mb-2 flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" />
              {t('common:billing.unavailableConnectionTips')}
            </p>
          )}
          <p className="mb-2 text-sm text-muted-foreground">{t('table:connection.description')}</p>
          {hasPermission && Boolean(maxNumDatabaseConnections)
            ? content
            : t('table:connection.noPermission')}
        </div>
      ) : null}
    </Fragment>
  );
};
