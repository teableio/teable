import { FieldType } from '@teable-group/core';
import type { IFilterMeta } from '@teable-group/core';
import { useFields } from '@teable-group/sdk';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useMemo } from 'react';
import { SingleSelector, MultipleSelect, FilterInput, FilterDatePicker } from '../component';

interface IFieldValue {
  filter: IFilterMeta;
  onSelect: (value: IFilterMeta['value']) => void;
}

function FieldValue(props: IFieldValue) {
  const { filter, onSelect } = props;
  const fields = useFields();

  const emptyComponent = <Input className="m-1" disabled />;
  const showEmptyComponent = useMemo(() => {
    return ['isNotEmpty', 'isEmpty'].includes(filter.operator);
  }, [filter]);

  const dynamicComponent = () => {
    const InputComponent = (
      <FilterInput placeholder="Enter a value" value={filter.value as string} onChange={onSelect} />
    );
    const componentType = fields.find((item) => item.id === filter.fieldId)?.type;

    switch (componentType) {
      case FieldType.Number:
        return InputComponent;
      case FieldType.SingleSelect:
        return <SingleSelector fieldId={filter.fieldId} value={filter.value} onSelect={onSelect} />;
      case FieldType.MultipleSelect:
        return (
          <MultipleSelect
            fieldId={filter.fieldId}
            value={filter.value as string[]}
            onSelect={onSelect}
          />
        );
      case FieldType.Date:
        return <FilterDatePicker value={filter.value as string} onSelect={onSelect} />;
      case FieldType.SingleLineText:
        return InputComponent;
      default:
        return InputComponent;
    }
  };
  return <>{showEmptyComponent ? emptyComponent : dynamicComponent()}</>;
}

export { FieldValue };
