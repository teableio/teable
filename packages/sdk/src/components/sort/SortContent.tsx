import type { ISort } from '@teable/core';
import { FieldType, SortFunc } from '@teable/core';
import { cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import { useFields } from '../../hooks';
import { useInDrawer } from '../adaptive-panel';
import { FieldCommand } from '../field/FieldCommand';
import { DraggableSortList } from './DraggableSortList';
import { SortFieldAddButton } from './SortFieldAddButton';

interface ISortProps {
  sortValues?: NonNullable<ISort>['sortObjs'];
  limit?: number;
  addBtnText?: string;
  /** Shown in place of the add button once `limit` is reached. Drawer only. */
  limitTip?: string;
  onChange: (sort?: NonNullable<ISort>['sortObjs']) => void;
}

export function SortContent(props: ISortProps) {
  const { onChange, sortValues = [], addBtnText, limitTip, limit = Infinity } = props;
  const inDrawer = useInDrawer();

  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);

  const selectedFieldIds = useMemo(
    () => sortValues.map((sort) => sort.fieldId) || [],
    [sortValues]
  );

  const onFieldSelect = (fieldId: string) => {
    onChange([
      {
        fieldId: fieldId,
        order: SortFunc.Asc,
      },
    ]);
  };

  const onFieldAdd = (value: string) => {
    onChange(
      sortValues.concat({
        fieldId: value,
        order: SortFunc.Asc,
      })
    );
  };

  const onSortChange = (sorts: NonNullable<ISort>['sortObjs']) => {
    onChange(sorts?.length ? sorts : undefined);
  };

  if (!sortValues.length) {
    return <FieldCommand fields={fields} onSelect={onFieldSelect} />;
  }

  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 py-4',
        // In a drawer the panel body is already the scroll container, so the
        // rule list must not introduce a second one with its own cap.
        inDrawer && 'gap-0 py-0'
      )}
    >
      <div
        className={cn(
          'flex max-h-96 flex-col gap-2 overflow-auto px-4',
          inDrawer && 'max-h-full w-full overflow-visible py-4'
        )}
      >
        <DraggableSortList
          sorts={sortValues}
          selectedFields={selectedFieldIds}
          onChange={onSortChange}
        />
      </div>
      {/* Without this the add button just disappears at the cap, with nothing
          to say why. Drawer only, to leave the desktop panel untouched. */}
      {inDrawer && limitTip && selectedFieldIds.length >= limit && (
        <div className="sticky bottom-0 w-full border-t bg-background px-4 py-3 text-[13px] text-muted-foreground">
          {limitTip}
        </div>
      )}
      {selectedFieldIds.length < limit && (
        <div className={cn(inDrawer && 'sticky bottom-0 w-full border-t bg-background p-4')}>
          <SortFieldAddButton
            addBtnText={addBtnText}
            selectedFieldIds={selectedFieldIds}
            onSelect={onFieldAdd}
          />
        </div>
      )}
    </div>
  );
}
