import { FieldType } from '@teable-group/core';
import type { IFilterMeta } from '@teable-group/core';
import { useField } from '@teable-group/sdk';
import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
import { useEffect, useMemo } from 'react';
import { SingleSelect, MultipleSelect, FilterInput, FilterDatePicker } from '../component';
import { EMPTYOPERATORS } from '../constant';

interface IFieldValue {
  filter: IFilterMeta;
  onSelect: (value: IFilterMeta['value']) => void;
}

function FieldValue(props: IFieldValue) {
  const { filter, onSelect } = props;
  const field = useField(filter.fieldId);

  const emptyComponent = <Input className="m-1" disabled />;
  const showEmptyComponent = useMemo(() => {
    const showEmpty = EMPTYOPERATORS.includes(filter.operator);
    showEmpty && onSelect?.(null);
    return showEmpty;
  }, [filter.operator, onSelect]);

  useEffect(() => {
    showEmptyComponent && onSelect(null);
  }, [onSelect, showEmptyComponent]);

  const dynamicComponent = () => {
    const InputComponent = (
      <FilterInput placeholder="Enter a value" value={filter.value as string} onChange={onSelect} />
    );

    switch (field?.type) {
      case FieldType.Number:
        return InputComponent;
      case FieldType.SingleSelect:
        return <SingleSelect fieldId={filter.fieldId} value={filter.value} onSelect={onSelect} />;
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
