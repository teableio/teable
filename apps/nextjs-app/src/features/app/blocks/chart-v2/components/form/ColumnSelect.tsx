import type { FieldType } from '@teable/core';
import { FieldSelect } from './field-select/FieldSelect';

interface IColumnSelectProps {
  value: string;
  onChange: (value: string) => void;
  allowType?: FieldType[];
  notAllowedFields?: FieldType[];
}

export const ColumnSelect = (props: IColumnSelectProps) => {
  const { value, onChange, allowType, notAllowedFields } = props;
  return (
    <FieldSelect
      value={value}
      onChange={onChange}
      allowType={allowType}
      notAllowedFields={notAllowedFields}
    />
  );
};
