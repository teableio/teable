import { FieldType, type IFilter } from '@teable/core';
import { Popover, PopoverTrigger, PopoverContent } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { useState } from 'react';
import { useDebounce, useLatest, useUpdateEffect } from 'react-use';
import { useTranslation } from '../../../context/app/i18n';
import { useFields, useTableId, useViewId, useTablePermission } from '../../../hooks';
import type { IFilterBaseComponent } from '../types';
import { BaseViewFilter } from './BaseViewFilter';
import { useFilterNode, useViewFilterLinkContext } from './hooks';
import type { IViewFilterConditionItem, IViewFilterLinkContext } from './types';

export interface IViewFilterProps {
  filters: IFilter;
  contentHeader?: React.ReactNode;
  onChange: (value: IFilter) => void;
  viewFilterLinkContext?: IViewFilterLinkContext;
  children?: (text: string, isActive?: boolean) => React.ReactNode;
  customValueComponent?: IFilterBaseComponent<IViewFilterConditionItem>;
}

export const ViewFilter = (props: IViewFilterProps) => {
  const { contentHeader, filters, children, onChange } = props;
  const { t } = useTranslation();
  const title = t('filter.tips.scope');
  const emptyText = t('filter.default.empty');
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  const { text, isActive } = useFilterNode(filters, fields);
  const latestValue = useLatest(filters);
  const [filter, setFilter] = useState(latestValue.current);

  useUpdateEffect(() => {
    if (!isEqual(latestValue.current, filter)) {
      setFilter(latestValue.current);
    }
  }, [latestValue.current]);

  const viewId = useViewId();
  const tableId = useTableId();
  const permission = useTablePermission();
  const viewFilterLinkContext = useViewFilterLinkContext(tableId, viewId, {
    disabled: !permission['view|update'],
  });
  const finalViewFilterLinkContext = props.viewFilterLinkContext || viewFilterLinkContext;

  const onChangeHandler = (value: IFilter) => {
    setFilter(value);
  };

  useDebounce(
    () => {
      if (!isEqual(filter, latestValue.current)) {
        onChange(filter);
      }
    },
    300,
    [filter]
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{children?.(text, isActive)}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex max-h-96 w-min min-w-[544px] max-w-screen-md flex-col overflow-hidden p-0"
      >
        {contentHeader}
        <div className="px-2 py-1 text-xs">
          {filters?.filterSet?.length ? (
            <div className="pt-2">{title}</div>
          ) : (
            <div className="pt-2 text-muted-foreground">{emptyText}</div>
          )}
        </div>
        <BaseViewFilter<IViewFilterConditionItem>
          fields={fields}
          value={filter}
          onChange={onChangeHandler}
          customValueComponent={props.customValueComponent}
          viewFilterLinkContext={finalViewFilterLinkContext}
        />
      </PopoverContent>
    </Popover>
  );
};
