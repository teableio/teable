import type { IBaseQuery } from '@teable/openapi';
import type { IBaseQueryBuilderRef } from '@teable/sdk';
import { BaseQueryBuilder } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useRef, useState } from 'react';
import { ChartContext } from '../ChartProvider';

export const ChartQuery = () => {
  const { tab, storage, onTabChange, onStorageChange } = useContext(ChartContext);
  const [query, setQuery] = useState<IBaseQuery | undefined>(storage?.query);
  const [isLoading, setLoading] = useState(false);
  const queryBuilderRef = useRef<IBaseQueryBuilderRef>(null);
  const { t } = useTranslation('chart');

  useEffect(() => {
    if (tab === 'query') {
      // TODO: refactor query builder, remove setTimeout
      setTimeout(() => {
        queryBuilderRef.current?.initContext();
      });
    }
  }, [tab]);

  return (
    <div className="flex size-full flex-col">
      <div className="flex h-10 w-full items-center justify-between border-b px-6">
        <div>{t('queryTitle')}</div>
        <div className="flex items-center gap-2">
          <Button
            className={cn({
              hidden: !storage?.query,
            })}
            variant="ghost"
            size="xs"
            onClick={() => onTabChange('chart')}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            size="xs"
            disabled={isLoading || !query}
            onClick={async () => {
              if (!query) {
                return;
              }
              setLoading(true);
              await onStorageChange(
                storage
                  ? {
                      ...storage,
                      query,
                    }
                  : { query }
              );
              setLoading(false);
              onTabChange('chart');
            }}
          >
            {t('actions.save')}
          </Button>
        </div>
      </div>
      {tab === 'query' && (
        <div className="flex-1 overflow-auto">
          <BaseQueryBuilder
            ref={queryBuilderRef}
            className="border-none p-8"
            query={query}
            onChange={setQuery}
          />
        </div>
      )}
    </div>
  );
};
