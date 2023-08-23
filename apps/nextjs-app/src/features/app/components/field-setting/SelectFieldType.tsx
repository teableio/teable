import { FieldType } from '@teable-group/core';
import { useFieldStaticGetter } from '@teable-group/sdk';
import { Selector } from '@teable-group/ui-lib/base';
import SearchIcon from '@teable-group/ui-lib/icons/app/search.svg';
import { useMemo } from 'react';
import { FIELD_TYPE_ORDER } from '../../utils/fieldTypeOrder';

export const SelectFieldType = (props: {
  value?: FieldType | 'lookup';
  onChange?: (type: FieldType | 'lookup') => void;
}) => {
  const { value = FieldType.SingleLineText, onChange } = props;
  const getFieldStatic = useFieldStaticGetter();
  const candidates = useMemo(
    () =>
      FIELD_TYPE_ORDER.map<{ id: FieldType | 'lookup'; name: string; icon: JSX.Element }>(
        (type) => {
          const { title, Icon } = getFieldStatic(type, false);
          return {
            id: type,
            name: title,
            icon: <Icon />,
          };
        }
      ).concat({
        id: 'lookup',
        name: 'Lookup to other table',
        icon: <SearchIcon className="h-4 w-4" />,
      }),
    [getFieldStatic]
  );

  return (
    <Selector
      candidates={candidates}
      selectedId={value}
      onChange={(id) => onChange?.(id as FieldType | 'lookup')}
    />
  );
};
