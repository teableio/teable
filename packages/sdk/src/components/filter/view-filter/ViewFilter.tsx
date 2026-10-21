import {
  FieldType,
  analyzeFilterValidationIssues,
  type IFilter,
  type IFilterValidationFieldMeta,
} from '@teable/core';
import { isEqual } from 'lodash';
import { useMemo, useRef, useState } from 'react';
import { useDebounce, useUpdateEffect } from 'react-use';
import { useTranslation } from '../../../context/app/i18n';
import { useFields, useTableId, useViewId } from '../../../hooks';
import { AdaptivePanel, useIsDrawerPanel } from '../../adaptive-panel';
import { ReadOnlyTip } from '../../ReadOnlyTip';
import type { IFilterBaseComponent } from '../types';
import { BaseViewFilter } from './BaseViewFilter';
import { FilterValidationContext, useFilterNode, useViewFilterLinkContext } from './hooks';
import type { IViewFilterConditionItem, IViewFilterLinkContext } from './types';

export interface IViewFilterProps {
  filters: IFilter;
  contentHeader?: React.ReactNode;
  onChange: (value: IFilter) => void | Promise<void>;
  viewFilterLinkContext?: IViewFilterLinkContext;
  children?: (text: string, isActive?: boolean, hasWarning?: boolean) => React.ReactNode;
  customValueComponent?: IFilterBaseComponent<IViewFilterConditionItem>;
  /** Render as a bottom drawer on narrow viewports. Toolbar call sites only. */
  responsive?: boolean;
}

export const ViewFilter = (props: IViewFilterProps) => {
  const { contentHeader, filters, children, responsive, onChange } = props;
  const { t } = useTranslation();
  const isDrawer = useIsDrawerPanel(responsive);
  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  // Toolbar label must track the local editing filter immediately. Waiting on the
  // server/collab `filters` prop leaves the button stuck on bare "Filter" until
  // reopen/refresh when realtime lag or personal-view sync is delayed.
  const [filter, setFilter] = useState(filters);
  const { text, isActive, hasWarning } = useFilterNode(filter, fields);

  // Validation errors against the local (editing) filter — lets the popover highlight
  // invalid rows in real time as the user fixes them.
  const validationErrors = useMemo(() => {
    const fieldMetaMap = fields.reduce<Record<string, IFilterValidationFieldMeta>>((acc, f) => {
      acc[f.id] = {
        type: f.type as FieldType,
        cellValueType: f.cellValueType,
        isMultipleCellValue: f.isMultipleCellValue,
      };
      return acc;
    }, {});
    return analyzeFilterValidationIssues(filter, fieldMetaMap);
  }, [filter, fields]);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Track local edit version to prevent stale server responses from overwriting local state
  // This solves the race condition where: user adds item A -> user adds item B -> server responds with A only -> UI flickers
  const localEditVersionRef = useRef(0);
  const lastSyncedVersionRef = useRef(0);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

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
      const currentVersion = localEditVersionRef.current;
      // A local edit that returns to the current prop still completes this version.
      // Without this acknowledgement, every later collaborator update is rejected.
      lastSyncedVersionRef.current = currentVersion;
      if (isEqual(filter, filters)) return;

      const rollback = () => {
        if (localEditVersionRef.current !== currentVersion) return;
        setFilter(filtersRef.current);
      };

      try {
        void Promise.resolve(onChange(filter)).catch(rollback);
      } catch {
        rollback();
      }
    },
    300,
    [filter]
  );

  return (
    <FilterValidationContext.Provider value={validationErrors}>
      <AdaptivePanel
        responsive={responsive}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        title={t('filter.label')}
        popoverClassName="relative flex max-h-96 w-min min-w-[468px] max-w-screen-md flex-col overflow-hidden rounded-lg p-4 pe-2 [&_[data-filter-condition-controls]]:flex-nowrap [&_[data-filter-condition-item]]:flex-nowrap"
        bodyClassName="flex flex-col overflow-hidden p-4"
        overlay={<ReadOnlyTip />}
        content={
          <>
            {contentHeader}
            <BaseViewFilter<IViewFilterConditionItem>
              fields={fields}
              value={filter}
              onChange={onChangeHandler}
              customValueComponent={props.customValueComponent}
              viewFilterLinkContext={finalViewFilterLinkContext}
              // Inside a drawer every nested popover must agree with the
              // drawer's modal layer, or Radix dismisses the wrong one.
              modal={isDrawer}
            />
          </>
        }
      >
        {children?.(text, isActive || popoverOpen, hasWarning)}
      </AdaptivePanel>
    </FilterValidationContext.Provider>
  );
};
