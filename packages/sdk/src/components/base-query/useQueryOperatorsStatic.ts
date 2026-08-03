import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { QuerySortedKeysMap } from './constant';

export const useQueryOperatorsStatic = () => {
  const { t } = useTranslation();
  return useMemo(() => {
    const statics = [
      { key: 'select', label: t('baseQuery.select.title') },
      { key: 'aggregation', label: t('baseQuery.aggregation.title') },
      { key: 'where', label: t('baseQuery.where.title') },
      { key: 'orderBy', label: t('baseQuery.orderBy.title') },
      { key: 'groupBy', label: t('baseQuery.groupBy.title') },
      { key: 'limit', label: t('baseQuery.limit.title') },
      { key: 'offset', label: t('baseQuery.offset.title') },
      { key: 'join', label: t('baseQuery.join.title') },
    ] as const;
    return Array.from(statics).sort(
      (a, b) => QuerySortedKeysMap[a.key] - QuerySortedKeysMap[b.key]
    );
  }, [t]);
};
