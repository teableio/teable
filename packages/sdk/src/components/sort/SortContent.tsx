import type { ISort } from '@teable-group/core';
import { useMemo } from 'react';
import { DraggableSortList } from './DraggableSortList';
import { SortFieldAddButton } from './SortFieldAddButton';
import { SortFieldCommand } from './SortFieldCommand';

interface ISortProps {
  sortValues?: ISort['sortObjs'];
  onChange: (sort?: ISort['sortObjs']) => void;
}

export function SortContent(props: ISortProps) {
  const { onChange, sortValues = [] } = props;

  const selectedFields = useMemo(() => sortValues.map((sort) => sort.fieldId) || [], [sortValues]);

  const fieldSelectHandler = (fieldId: string) => {
    onChange([
      {
        fieldId: fieldId,
        order: 'asc',
      },
    ]);
  };

  const fieldAddHandler = (value: string) => {
    onChange(
      sortValues.concat({
        fieldId: value,
        order: 'asc',
      })
    );
  };

  const sortChangeHandler = (sorts: ISort['sortObjs']) => {
    if (sorts?.length) {
      onChange(sorts);
    } else {
      onChange(undefined);
    }
  };

  if (!sortValues.length) {
    return <SortFieldCommand onSelect={fieldSelectHandler} />;
  }

  return (
    <div className="flex flex-col">
      <div className="max-h-96 overflow-auto p-3">
        {
          <DraggableSortList
            sorts={sortValues}
            onChange={sortChangeHandler}
            selectedFields={selectedFields}
          />
        }
      </div>
      <SortFieldAddButton onSelect={fieldAddHandler} selectedFields={selectedFields} />
    </div>
  );
}
