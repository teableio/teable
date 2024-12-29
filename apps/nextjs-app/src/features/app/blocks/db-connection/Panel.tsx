import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Code2, HelpCircle } from '@teable/icons';
import { deleteDbConnection, getDbConnection, createDbConnection } from '@teable/openapi';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { Button, Skeleton } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Trans, useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { CopyButton } from '../../components/CopyButton';

const ContentCard = () => {
  const baseId = useBaseId() as string;
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { data, isLoading } = useQuery({
    queryKey: ['connection', baseId],
    queryFn: ({ queryKey }) => getDbConnection(queryKey[1]).then((data) => data.data),
  });

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
  const dataArray = data?.dsn
    ? Object.entries(data?.dsn).map(([label, value]) => {
        if (label === 'params') {
          const display = Object.entries(value)
            .map((v) => v.join('='))
            .join('&');
          return {
            label,
            display,
            value: display,
          };
        }
        if (label === 'pass') {
          return {
            label,
            display: '********',
            value: String(value ?? ''),
          };
        }
        return { label, value: String(value ?? ''), display: String(value ?? '') };
      })
    : [];

  dataArray.unshift({
    label: 'url',
    display: (data?.url || '').replace(data?.dsn?.pass || '', '********'),
    value: data?.url || '',
  });

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : (
        data && (
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
        )
      )}
      {!data && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => mutationCreate.mutate(baseId)}>
            {t('common:actions.create')}
          </Button>
        </div>
      )}
    </div>
  );
};

export const DbConnectionPanel = ({ className }: { className?: string }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permissions = useBasePermission();

  return (
    <div className={className}>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex items-center gap-2">
          <Code2 className="size-4" />
          <h2 className="font-semibold">{t('table:connection.title')}</h2>
        </div>
        <Button variant="ghost" size="icon">
          <a href={t('table:connection.helpLink')} target="_blank" rel="noreferrer">
            <HelpCircle className="size-4" />
          </a>
        </Button>
      </div>
      <p className="mb-2 text-sm text-muted-foreground">{t('table:connection.description')}</p>
      {permissions?.['base|db_connection'] ? <ContentCard /> : t('table:connection.noPermission')}
    </div>
  );
};
