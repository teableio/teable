import type { IItemBaseCollaboratorUser } from '@teable/openapi';
import { TableTrashType } from '@teable/openapi';
import { UserAvatar, UserOption } from '@teable/sdk/components';
import { BaseMultipleSelect } from '@teable/sdk/components/filter/view-filter/component/base';
import type { IDateRangeValue } from '@teable/sdk/components/filter/view-filter/component/filterDatePicker/DateRangePicker';
import { DateRangePicker } from '@teable/sdk/components/filter/view-filter/component/filterDatePicker/DateRangePicker';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface ITrashTypeOption {
  value: TableTrashType;
  label: string;
}

interface ITrashUserOption {
  value: string;
  label: string;
  email?: string;
  avatar?: string | null;
}

interface ITableTrashFilterBarProps {
  users: IItemBaseCollaboratorUser[];
  resourceTypes: TableTrashType[];
  deletedByIds: string[];
  dateRange: IDateRangeValue | null;
  onResourceTypesChange: (value: TableTrashType[]) => void;
  onDeletedByIdsChange: (value: string[]) => void;
  onDateRangeChange: (value: IDateRangeValue | null) => void;
  onUserSearch: (value: string) => void;
  onReset: () => void;
}

export const TableTrashFilterBar = (props: ITableTrashFilterBarProps) => {
  const {
    users,
    resourceTypes,
    deletedByIds,
    dateRange,
    onResourceTypesChange,
    onDeletedByIdsChange,
    onDateRangeChange,
    onUserSearch,
    onReset,
  } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const typeOptions = useMemo<ITrashTypeOption[]>(
    () => [
      { value: TableTrashType.View, label: t('noun.view') },
      { value: TableTrashType.Field, label: t('noun.field') },
      { value: TableTrashType.Record, label: t('noun.record') },
    ],
    [t]
  );

  const userOptions = useMemo<ITrashUserOption[]>(
    () =>
      users.map((user) => ({
        value: user.id,
        label: user.name,
        email: user.email,
        avatar: user.avatar,
      })),
    [users]
  );

  const renderUserOption = useCallback((option: ITrashUserOption) => {
    return (
      <UserOption
        className="w-full gap-2 truncate"
        avatar={option.avatar}
        name={option.label}
        email={option.email}
      />
    );
  }, []);

  const renderUserDisplay = useCallback((option: ITrashUserOption) => {
    return (
      <div className="flex h-6 max-w-32 items-center gap-1.5 rounded bg-secondary pe-2 ps-1 text-xs">
        <UserAvatar name={option.label} avatar={option.avatar} className="size-5" />
        <span className="truncate">{option.label}</span>
      </div>
    );
  }, []);

  const hasFilter = resourceTypes.length > 0 || deletedByIds.length > 0 || dateRange != null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <BaseMultipleSelect
          value={resourceTypes}
          options={typeOptions}
          onSelect={onResourceTypesChange}
          className="h-8 w-40"
          popoverClassName="w-56"
          placeholderClassName="text-xs"
          placeholder={t('table:tableTrash.filterAllTypes')}
          notFoundText={t('sdk:common.noRecords')}
          modal
        />
        <BaseMultipleSelect
          value={deletedByIds}
          options={userOptions}
          onSelect={onDeletedByIdsChange}
          displayRender={renderUserDisplay}
          optionRender={renderUserOption}
          onSearch={onUserSearch}
          className="h-8 w-44"
          popoverClassName="w-72"
          placeholderClassName="text-xs"
          placeholder={t('table:tableTrash.filterAllUsers')}
          notFoundText={t('sdk:common.noRecords')}
          modal
        />
        <DateRangePicker
          value={dateRange}
          onChange={onDateRangeChange}
          placeholder={t('table:tableTrash.filterDeletedTime')}
          className="h-8 w-52 text-xs"
          modal
        />
      </div>
      {hasFilter && (
        <Button variant="outline" size="sm" onClick={onReset}>
          {t('table:tableTrash.clearFilter')}
        </Button>
      )}
    </div>
  );
};
