import { useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useContext } from 'react';
import { useEnv } from '../../../hooks/useEnv';
import { ChartContext } from '../../ChartProvider';

export const QueryStatus = () => {
  const { queryError, onTabChange } = useContext(ChartContext);
  const { baseId } = useEnv();
  const { storage } = useContext(ChartContext);
  const query = storage?.query;
  const queryClient = useQueryClient();
  const { t } = useTranslation('chart');
  const refreshQuery = () => {
    queryClient.invalidateQueries(['baseQuery', baseId, query]);
  };

  return (
    <div
      className={cn(
        'absolute inset-x-0 top-0 flex h-10 items-center justify-center bg-green-100 text-sm text-green-900 dark:bg-green-900 dark:text-green-100 z-10',
        {
          'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100': queryError,
        }
      )}
    >
      {queryError ? t('form.queryError') : t('form.querySuccess')}
      <Button
        className={cn('h-auto text-green-900 underline dark:text-green-100', {
          'text-red-900 dark:text-red-100': queryError,
        })}
        size={'xs'}
        variant="link"
        onClick={() => onTabChange('query')}
      >
        {t('form.updateQuery')}
      </Button>
      <Button
        title={t('reloadQuery')}
        className="h-auto p-0 pt-0.5"
        size={'xs'}
        variant="link"
        onClick={refreshQuery}
      >
        <RefreshCcw />
      </Button>
    </div>
  );
};
