import type { IUserCellValue } from '@teable-group/core';
import type { UserField } from '../../../model';
import { UserEditorMain } from '../../editor/user';
import type { IEditorProps } from '../../grid';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

export const GridUserEditor = (props: IWrapperEditorProps & IEditorProps) => {
  const { field, record, rect, style } = props;
  const { id: fieldId, options } = field as UserField;

  const cellValue = record.getCellValue(field.id) as IUserCellValue | IUserCellValue[];

  const attachStyle = useGridPopupPosition(rect, 340);
  const onChange = (value?: IUserCellValue | IUserCellValue[]) => {
    record.updateCell(fieldId, value);
  };

  return (
    <UserEditorMain
      style={{
        ...style,
        ...attachStyle,
        height: 'auto',
        minWidth: 280,
      }}
      className="absolute rounded-sm border shadow-sm"
      value={cellValue}
      options={options}
      onChange={onChange}
    />
  );
};
