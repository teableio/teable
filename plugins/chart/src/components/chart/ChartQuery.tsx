import type { IBaseQuery } from '@teable/openapi';
import type { IBaseQueryBuilderRef } from '@teable/sdk';
import { BaseQueryBuilder } from '@teable/sdk';
import { Button, cn } from '@teable/ui-lib';
import { useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartContext } from '../ChartProvider';

export const ChartQuery = () => {
  const { tab, storage, onTabChange, onStorageChange } = useContext(ChartContext);
  const [query, setQuery] = useState<IBaseQuery | undefined>(storage?.query);
  const [isLoading, setLoading] = useState(false);
  const queryBuilderRef = useRef<IBaseQueryBuilderRef>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (tab === 'query') {
      queryBuilderRef.current?.initContext(undefined);
    }
  }, [tab]);

  return (
    <div className="flex size-full flex-col">
      <div className="flex h-10 w-full items-center justify-between border-b px-6">
        <div>{t('queryTitle')}</div>
        <div>
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
        <BaseQueryBuilder
          ref={queryBuilderRef}
          className="border-none p-8"
          query={query}
          onChange={setQuery}
        />
      )}
    </div>
  );
};
