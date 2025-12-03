import { useQuery } from '@tanstack/react-query';
import type { ViewType } from '@teable/core';
import { Sheet } from '@teable/icons';
import { getViewList } from '@teable/openapi';
import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component/base/BaseSingleSelect';
import { VIEW_ICON_MAP } from '@teable/sdk/components/view/constant';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';

interface ViewSelectProps {
  value?: string | null;
  tableId: string;
  typeFilter?: ViewType;
  onChange: (value: string | null) => void;
  cancelable?: boolean;
}

export const ViewSelect = (props: ViewSelectProps) => {
  const { value = 'all', onChange, tableId, typeFilter, cancelable = false } = props;

  const { data: viewRawData } = useQuery({
    queryKey: ReactQueryKeys.viewList(tableId),
    queryFn: () => getViewList(tableId).then((res) => res.data),
    enabled: !!tableId,
    meta: { preventGlobalError: true },
  });

  const { t } = useTranslation(['chart', 'common']);

  const viewList = useMemo(() => {
    return (
      (typeFilter ? viewRawData?.filter((view) => view.type === typeFilter) : viewRawData) || []
    );
  }, [viewRawData, typeFilter]);

  const options = useMemo(() => {
    const views = viewList.map(({ id, type, name }) => ({
      value: id,
      label: name,
      icon: VIEW_ICON_MAP[type],
    }));
    views?.unshift({
      value: 'all',
      label: t('chartV2.form.view.allData'),
      icon: () => <Sheet />,
    });
    return views;
  }, [viewList, t]);

  const displayRender = (option: (typeof options)[number]) => {
    const { icon: Icon, label } = option;
    return (
      <div className="flex items-center justify-start">
        <div className="shrink-0">{Icon && <Icon></Icon>}</div>
        <div className="truncate pl-1 text-[13px]">{label}</div>
      </div>
    );
  };

  const notFoundRender = useMemo(() => {
    return <span className="text-red-500">{t('common:noResult')}</span>;
  }, [t]);

  return (
    <BaseSingleSelect
      modal
      options={options}
      value={value || 'all'}
      onSelect={(newValue) => {
        onChange(newValue === 'all' ? null : newValue);
      }}
      popoverClassName="w-[350px]"
      displayRender={displayRender}
      optionRender={displayRender}
      cancelable={cancelable}
      className="my-1 h-9"
      defaultLabel={notFoundRender}
    />
  );
};
