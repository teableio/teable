import type { GridViewOptions } from '@teable-group/core';
import {
  ArrowUpDown,
  PaintBucket,
  Filter as FilterIcon,
  EyeOff,
  LayoutList,
} from '@teable-group/icons';
import { Filter, HideFields, RowHeight, useFields, Sort, Group } from '@teable-group/sdk';
import { useView } from '@teable-group/sdk/hooks/use-view';
import { useToolbarChange } from '../hooks/useToolbarChange';
import { ToolBarButton } from './ToolBarButton';

export const ViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView();
  const fields = useFields();

  const { onFilterChange, onRowHeightChange, onSortChange, onGroupChange } = useToolbarChange();

  if (!view || !fields.length) {
    return <div></div>;
  }

  return (
    <div className="flex gap-1">
      <HideFields>
        {(text, isActive) => (
          <ToolBarButton disabled={disabled} isActive={isActive} text={text}>
            <EyeOff className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </HideFields>
      <Filter filters={view?.filter || null} onChange={onFilterChange}>
        {(text, isActive) => (
          <ToolBarButton disabled={disabled} isActive={isActive} text={text} className="max-w-xs">
            <FilterIcon className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Filter>
      <Sort sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton disabled={disabled} isActive={isActive} text={text}>
            <ArrowUpDown className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
      <Group group={view?.group || null} onChange={onGroupChange}>
        {(text: string, isActive) => (
          <ToolBarButton disabled={disabled} isActive={isActive} text={text}>
            <LayoutList className="h-4 w-4 text-sm" />
          </ToolBarButton>
        )}
      </Group>
      <ToolBarButton disabled={disabled} text="Color">
        <PaintBucket className="h-4 w-4 text-sm" />
      </ToolBarButton>
      <RowHeight
        rowHeight={(view?.options as GridViewOptions)?.rowHeight || null}
        onChange={onRowHeightChange}
      >
        {(_, isActive, Icon) => (
          <ToolBarButton disabled={disabled} isActive={isActive}>
            <Icon className="text-sm" />
          </ToolBarButton>
        )}
      </RowHeight>
    </div>
  );
};
