import type { ISort } from '@teable/core';
import { SortFunc } from '@teable/core';
import { DraggableSortList } from '@teable/sdk/components/sort/DraggableSortList';
import { SortFieldAddButton } from '@teable/sdk/components/sort/SortFieldAddButton';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { developerConfig } from '@/features/i18n/developer.config';

interface ISortProps {
  orderBy?: NonNullable<ISort>['sortObjs'];
  onChange: (orderBy?: NonNullable<ISort>['sortObjs']) => void;
}

export function OrderByBuilder(props: ISortProps) {
  const { onChange, orderBy = [] } = props;
  const { t } = useTranslation(developerConfig.i18nNamespaces);

  const selectedFieldIds = useMemo(() => orderBy.map((sort) => sort.fieldId) || [], [orderBy]);

  const onFieldAdd = (value: string) => {
    onChange(
      orderBy.concat({
        fieldId: value,
        order: SortFunc.Asc,
      })
    );
  };

  const onSortChange = (sorts: NonNullable<ISort>['sortObjs']) => {
    onChange(sorts?.length ? sorts : undefined);
  };

  return (
    <div className="flex w-96 flex-col">
      <div className="max-h-96 overflow-auto p-3">
        <DraggableSortList
          sorts={orderBy}
          selectedFields={selectedFieldIds}
          onChange={onSortChange}
        />
      </div>
      <SortFieldAddButton
        addBtnText={t('developer:addSort')}
        selectedFieldIds={selectedFieldIds}
        onSelect={onFieldAdd}
      />
    </div>
  );
}
