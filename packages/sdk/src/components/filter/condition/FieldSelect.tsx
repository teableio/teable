import { useCallback, useMemo } from 'react';
import { useFields, useFieldStaticGetter } from '../../../hooks';

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
          <Icon className="shrink-0"></Icon>
          <div className="pl-1 truncate text-[13px]">{option.label}</div>
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
      className="w-32 shrink"
      popoverClassName="w-fit"
      optionRender={optionRender}
    />
  );
}

FieldSelect.displayName = 'FieldSelect';

export { FieldSelect };
