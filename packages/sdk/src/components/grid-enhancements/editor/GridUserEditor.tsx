import type { IUserCellValue } from '@teable-group/core';
import type { UserField } from '../../../model';
import { UserEditorMain } from '../../editor/user';
import type { IWrapperEditorProps } from './type';

export const GridUserEditor = (props: IWrapperEditorProps) => {
  const { field, record, style } = props;
  const { id: fieldId, options } = field as UserField;

  const cellValue = record.getCellValue(field.id) as IUserCellValue | IUserCellValue[];

  const onChange = (value?: IUserCellValue | IUserCellValue[]) => {
    record.updateCell(fieldId, value);
  };

  return <UserEditorMain style={style} value={cellValue} options={options} onChange={onChange} />;
};
