import { FieldType, type IFilter } from '@teable/core';
import { Popover, PopoverTrigger, PopoverContent, cn } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { useRef, useState } from 'react';
import { useDebounce, useUpdateEffect } from 'react-use';
import { useFields, useTableId, useViewId } from '../../../hooks';
import { ReadOnlyTip } from '../../ReadOnlyTip';
import type { IFilterBaseComponent } from '../types';
import { BaseViewFilter } from './BaseViewFilter';
import { useFilterNode, useViewFilterLinkContext } from './hooks';
import type { IViewFilterConditionItem, IViewFilterLinkContext } from './types';

export interface IViewFilterProps {
  filters: IFilter;
  contentHeader?: React.ReactNode;
  onChange: (value: IFilter) => void;
  viewFilterLinkContext?: IViewFilterLinkContext;
  children?: (text: string, isActive?: boolean, hasWarning?: boolean) => React.ReactNode;
  customValueComponent?: IFilterBaseComponent<IViewFilterConditionItem>;
}

export const ViewFilter = (props: IViewFilterProps) => {
  const { contentHeader, filters, children, onChange } = props;
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  const { text, isActive, hasWarning } = useFilterNode(filters, fields);
  const [filter, setFilter] = useState(filters);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Track local edit version to prevent stale server responses from overwriting local state
  // This solves the race condition where: user adds item A -> user adds item B -> server responds with A only -> UI flickers
  const localEditVersionRef = useRef(0);
  const lastSyncedVersionRef = useRef(0);

  useUpdateEffect(() => {
    // Only accept server updates if no local edits are pending
    // This prevents stale server responses from overwriting optimistic updates
    if (localEditVersionRef.current === lastSyncedVersionRef.current && !isEqual(filters, filter)) {
      setFilter(filters);
    }
  }, [filters]);

  const viewId = useViewId();
  const tableId = useTableId();
  const viewFilterLinkContext = useViewFilterLinkContext(tableId, viewId, {
    disabled: Boolean('viewFilterLinkContext' in props),
  });
  const finalViewFilterLinkContext = props.viewFilterLinkContext || viewFilterLinkContext;

  const onChangeHandler = (value: IFilter) => {
    // Increment local edit version on every user change
    localEditVersionRef.current += 1;
    setFilter(value);
  };

  useDebounce(
    () => {
      if (!isEqual(filter, filters)) {
        // Capture current version before sending to server
        const currentVersion = localEditVersionRef.current;
        onChange(filter);
        // Mark this version as synced after onChange is called
        // This allows subsequent server responses to be accepted
        lastSyncedVersionRef.current = currentVersion;
      }
    },
    300,
    [filter]
  );

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        {children?.(text, isActive || popoverOpen, hasWarning)}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className={cn(
          'flex max-h-96 w-min min-w-[498px] max-w-screen-md flex-col overflow-hidden rounded-lg p-4 pr-2 relative'
        )}
      >
        <ReadOnlyTip />
        {contentHeader}
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
