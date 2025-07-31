import type { ISort } from '@teable/core';
import { FieldType, SortFunc } from '@teable/core';
import { useMemo } from 'react';
import { useFields } from '../../hooks';
import { FieldCommand } from '../field/FieldCommand';
import { DraggableSortList } from './DraggableSortList';
import { SortFieldAddButton } from './SortFieldAddButton';

interface ISortProps {
  sortValues?: NonNullable<ISort>['sortObjs'];
  limit?: number;
  addBtnText?: string;
  onChange: (sort?: NonNullable<ISort>['sortObjs']) => void;
}

export function SortContent(props: ISortProps) {
  const { onChange, sortValues = [], addBtnText, limit = Infinity } = props;

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
    <div className="flex flex-col">
      <div className="max-h-96 overflow-auto p-3">
        <DraggableSortList
          sorts={sortValues}
          selectedFields={selectedFieldIds}
          onChange={onSortChange}
        />
      </div>
      {selectedFieldIds.length < limit && (
        <SortFieldAddButton
          addBtnText={addBtnText}
          selectedFieldIds={selectedFieldIds}
          onSelect={onFieldAdd}
        />
      )}
    </div>
  );
}
