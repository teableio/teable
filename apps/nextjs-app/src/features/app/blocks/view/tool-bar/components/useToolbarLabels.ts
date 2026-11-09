import type { IFilter, IFilterSet, IGroup, ISort } from '@teable/core';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

/** A filter's conditions, however deeply they are grouped. */
const countConditions = (filter: IFilter | IFilterSet | null | undefined): number =>
  filter?.filterSet.reduce(
    (sum, item) => sum + ('filterSet' in item ? countConditions(item) : 1),
    0
  ) ?? 0;

/**
 * The toolbar's labels: the setting's name, and once it is on, how many conditions, sorts, groups
 * or hidden fields it holds — never the field names, which took the most room.
 */
export const useToolbarLabels = () => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const label = (
    active: boolean | undefined,
    name: 'hidden' | 'filter' | 'sort' | 'group',
    count: number
  ): string =>
    active
      ? t(`table:toolbar.countLabel.${name}Count`, { count })
      : t(`table:toolbar.countLabel.${name}`);
  return {
    hidden: (hiddenCount = 0) => label(hiddenCount > 0, 'hidden', hiddenCount),
    filter: (isActive: boolean | undefined, filter: IFilter | null | undefined) =>
      label(isActive, 'filter', Math.max(countConditions(filter), 1)),
    sort: (isActive: boolean | undefined, sort: ISort | null | undefined) =>
      label(isActive, 'sort', sort?.sortObjs?.length ?? 0),
    group: (isActive: boolean | undefined, group: IGroup | null | undefined) =>
      label(isActive, 'group', group?.length ?? 0),
  };
};
