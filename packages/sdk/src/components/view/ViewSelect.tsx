import { useQuery } from '@tanstack/react-query';
import type { ViewType } from '@teable/core';
import { getViewList } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import { ReactQueryKeys } from '../../config';
import { BaseSingleSelect } from '../filter/view-filter/component';
import { VIEW_ICON_MAP } from './constant';

interface ViewSelectProps {
  value?: string | null;
  tableId: string;
  className?: string;
  typeFilter?: ViewType;
  cancelable?: boolean;
  onChange: (value: string | null) => void;
}

export const ViewSelect = (props: ViewSelectProps) => {
  const { value = null, onChange, tableId, className, typeFilter, cancelable = false } = props;

  const { data: viewRawData } = useQuery({
    queryKey: ReactQueryKeys.viewList(tableId),
    queryFn: () => getViewList(tableId).then((res) => res.data),
    enabled: !!tableId,
  });

  const viewList =
    (typeFilter ? viewRawData?.filter((view) => view.type === typeFilter) : viewRawData) || [];

  const options = viewList.map(({ id, type, name }) => ({
    value: id,
    label: name,
    icon: VIEW_ICON_MAP[type],
  }));

  const displayRender = (option: (typeof options)[number]) => {
    const { icon: Icon, label } = option;
    return (
      <div className="flex items-center justify-start">
        <div className="shrink-0">{Icon && <Icon className="size-4" />}</div>
        <div className="truncate pl-2">{label}</div>
      </div>
    );
  };

  return (
    <BaseSingleSelect
      options={options}
      value={value}
      onSelect={(newValue) => {
        onChange(newValue);
      }}
      popoverClassName="w-[350px]"
      displayRender={displayRender}
      optionRender={displayRender}
      cancelable={cancelable}
      className={cn('my-1 h-9', className)}
      modal
    />
  );
};
