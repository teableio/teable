import { useMutation, useQuery } from '@tanstack/react-query';
import { checkBaseIntegrity, fixBaseIntegrity } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { Loader2, Check } from 'lucide-react';
import { useTranslation } from 'next-i18next';

export const IntegrityButton = () => {
  const base = useBase();
  const { t } = useTranslation(['table']);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['baseIntegrity', base.id],
    queryFn: () => checkBaseIntegrity(base.id).then(({ data }) => data),
    enabled: false,
  });

  const { mutateAsync: fixIntegrity } = useMutation({
    mutationFn: () => fixBaseIntegrity(base.id),
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
                {data?.linkFieldIssues?.[0]?.baseName && (
                  <div className="mb-2 font-medium">{data.linkFieldIssues[0].baseName}</div>
                )}

                <div className="max-h-96  max-w-md overflow-y-auto">
                  {data?.linkFieldIssues?.map((issues, index) => (
                    <div key={index} className="mb-2 ml-4 text-sm">
                      {issues.issues.map((issue) => (
                        <div key={issue.type}>
                          <div>Type: {issue.type}</div>
                          <div>Message: {issue.message}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => fixIntegrity()} size="sm" className="mt-2">
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
