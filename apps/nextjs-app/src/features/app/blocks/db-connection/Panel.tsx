import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Database, HelpCircle } from '@teable/icons';
import { deleteDbConnection, getDbConnection, createDbConnection } from '@teable/openapi';
import { useBase, useBasePermission } from '@teable/sdk/hooks';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
} from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

const ContentCard = () => {
  const base = useBase();
  const queryClient = useQueryClient();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { data, isLoading } = useQuery({
    queryKey: ['connection', base.id],
    queryFn: ({ queryKey }) => getDbConnection(queryKey[1]),
  });

  const mutationCreate = useMutation(createDbConnection, {
    onSuccess: () => {
      queryClient.invalidateQueries(['connection', base.id]);
    },
  });

  const mutationDelete = useMutation(deleteDbConnection, {
    onSuccess: () => {
      queryClient.invalidateQueries(['connection', base.id]);
    },
  });
  const dataArray = data?.data?.dsn
    ? Object.entries(data?.data?.dsn).map(([label, value]) => {
        if (label === 'params') {
          return {
            label,
            type: 'text',
            value: Object.entries(value)
              .map((v) => v.join('='))
              .join('&'),
          };
        }
        if (label === 'pass') {
          return {
            label,
            type: 'password',
            value: String(value ?? ''),
          };
        }
        return { label, type: 'text', value: String(value ?? '') };
      })
    : [];

  dataArray.unshift({
    label: 'url',
    type: 'text',
    value: data?.data?.url || '',
  });

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {dataArray.map(({ label, type, value }) => (
              <div key={label} className="flex flex-col gap-2">
                {data?.data ? (
                  <div className="flex items-center gap-2">
                    <Label className="w-20" htmlFor="subject">
                      {label}
                    </Label>
                    <Input
                      readOnly
                      data-pass={label === 'pass' ? true : undefined}
                      type={type}
                      value={value}
                      onMouseEnter={(e) => {
                        if ((e.target as HTMLInputElement).type === 'password') {
                          (e.target as HTMLInputElement).type = 'text';
                        }
                      }}
                      onMouseLeave={(e) => {
                        console.log(e.target);
                        if ((e.target as HTMLInputElement).getAttribute('data-pass')) {
                          (e.target as HTMLInputElement).type = 'password';
                        }
                      }}
                    />
                    <Button
                      className="shrink-0"
                      size="icon"
                      variant={'outline'}
                      onClick={() => {
                        navigator.clipboard.writeText(value);
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-20 justify-center">
                    <Database className="size-20 text-neutral-600" />
                  </div>
                )}
              </div>
            ))}
          </div>
          {data?.data && (
            <div className="text-sm text-secondary-foreground">
              <Trans
                ns="table"
                i18nKey="connection.connectionCountTip"
                components={{ b: <b /> }}
                values={{
                  max: data?.data?.connection.max,
                  current: data?.data?.connection.current,
                }}
              />
            </div>
          )}
          <div className="flex justify-end">
            {data?.data ? (
              <Button size="sm" onClick={() => mutationDelete.mutate(base.id)}>
                {t('common:actions.delete')}
              </Button>
            ) : (
              <Button size="sm" onClick={() => mutationCreate.mutate(base.id)}>
                {t('common:actions.create')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const DbConnectionPanel = ({ className }: { className?: string }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const permissions = useBasePermission();

  return (
    <Card className={className}>
      <CardHeader className="py-4">
        <CardTitle>
          {t('table:connection.title')}
          <Button variant="ghost" size="icon">
            <a href={t('table:connection.helpLink')} target="_blank" rel="noreferrer">
              <HelpCircle className="size-4" />
            </a>
          </Button>
        </CardTitle>
        <CardDescription>{t('table:connection.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {permissions['base|db_connection'] ? <ContentCard /> : t('table:connection.noPermission')}
      </CardContent>
    </Card>
  );
};
