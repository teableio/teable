import { useMutation, useQuery } from '@tanstack/react-query';
import {
  checkBaseIntegrity,
  fixBaseIntegrity,
  getV2SchemaIntegrityDecision,
} from '@teable/openapi';
import { useBase, useTables } from '@teable/sdk/hooks';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { Check, Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'next-i18next';
import { IntegrityV2Dialog } from './IntegrityV2Dialog';

const LegacyIntegrityButton = ({ baseId, tableId }: { baseId: string; tableId: string }) => {
  const { t } = useTranslation(['table']);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['baseIntegrity', baseId, tableId],
    queryFn: () => checkBaseIntegrity(baseId, tableId).then(({ data }) => data),
    enabled: false,
  });

  const { mutateAsync: fixIntegrity } = useMutation({
    mutationFn: () => fixBaseIntegrity(baseId, tableId),
    onSuccess: () => {
      refetch();
    },
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="xs" variant="outline" onClick={() => refetch()}>
          {t('table:table.integrity.check')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        {isLoading ? (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="size-6 animate-spin" />
            <span className="ml-2">{t('table:table.integrity.loading')}</span>
          </div>
        ) : (
          <div className="py-2">
            {data?.hasIssues ? (
              <>
                {data.linkFieldIssues?.[0]?.baseName ? (
                  <div className="mb-2 font-medium">{data.linkFieldIssues[0].baseName}</div>
                ) : null}

                <div className="max-h-96 max-w-md overflow-y-auto">
                  {data.linkFieldIssues?.map((issues, index) => (
                    <div key={index} className="mb-2 ml-4 text-sm">
                      {issues.issues.map((issue) => (
                        <div key={issue.type}>
                          <div>
                            {t('table:table.integrity.type')}:{' '}
                            {t(`table:table.integrity.errorType.${issue.type}`)}
                          </div>
                          <div>
                            {t('table:table.integrity.message')}: {issue.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button size="sm" className="mt-2" onClick={() => fixIntegrity()}>
                    {t('table:table.integrity.fixIssues')}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-2">
                <Check className="size-6 text-green-500" />
                <span className="ml-2 text-green-500">{t('table:table.integrity.allGood')}</span>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

export const IntegrityButton = () => {
  const base = useBase();
  const tables = useTables();
  const { t } = useTranslation(['table']);
  const searchParams = useSearchParams();
  const tableId = searchParams.get('tableId') ?? '';
  const tableName = tables.find((table) => table.id === tableId)?.name;

  const { data, isLoading } = useQuery({
    queryKey: ['v2SchemaIntegrityDecision', base.id],
    queryFn: () => getV2SchemaIntegrityDecision(base.id).then(({ data }) => data),
    enabled: Boolean(base.id),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Button size="xs" variant="outline" disabled>
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t('table:table.integrity.check')}
      </Button>
    );
  }

  if (data?.useV2) {
    return (
      <IntegrityV2Dialog
        baseId={base.id}
        baseName={base.name}
        tableId={tableId || undefined}
        tableName={tableName}
      />
    );
  }

  return <LegacyIntegrityButton baseId={base.id} tableId={tableId} />;
};
