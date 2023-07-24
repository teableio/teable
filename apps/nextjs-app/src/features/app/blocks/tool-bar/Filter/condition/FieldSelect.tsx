import { useFields } from '@teable-group/sdk';

import { useCallback, useMemo } from 'react';
import { useFieldStaticGetter } from '@/features/app/utils';

import { BaseSingleSelect } from '../component';

interface IFieldSelectProps {
  fieldId: string | null;
  onSelect: (type: string | null) => void;
}

function FieldSelect(props: IFieldSelectProps) {
  const { fieldId: value, onSelect } = props;

  const fields = useFields({ widthHidden: true });
  const options = useMemo(() => {
    return fields.map((field) => ({
      value: field.id,
      label: field.name,
      ...field,
    }));
  }, [fields]);
  const fieldStaticGetter = useFieldStaticGetter();

  const optionRender = useCallback(
    (option: typeof options[number]) => {
      const { Icon } = fieldStaticGetter(option.type, option.isLookup);
      return (
        <>
          <Icon></Icon>
          <div className="pl-1 truncate">{option.label}</div>
        </>
      );
    },
    [fieldStaticGetter]
  );

  return (
    <BaseSingleSelect
      options={options}
      onSelect={onSelect}
      value={value}
      className="w-40 max-w-[160px]"
      popoverClassName="w-40"
      optionRender={optionRender}
    />
  );
}

FieldSelect.displayName = 'FieldSelect';

export { FieldSelect };
