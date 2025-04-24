import type { IUserCellValue } from '@teable/core';
import type { ForwardRefRenderFunction } from 'react';
import { useRef, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { UserField } from '../../../model';
import type { IEditorRef } from '../../editor/type';
import { UserEditorMain } from '../../editor/user';
import type { IEditorProps } from '../../grid';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

const GridUserEditorBase: ForwardRefRenderFunction<
  IEditorRef<string>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { field, record, rect, style, isEditing } = props;
  const { t } = useTranslation();
  const { id: fieldId, options } = field as UserField;
  const cellValue = record.getCellValue(field.id) as IUserCellValue | IUserCellValue[];

  const defaultFocusRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<IEditorRef<IUserCellValue | IUserCellValue[] | undefined>>(null);

  useImperativeHandle(ref, () => ({
    focus: () => (editorRef.current || defaultFocusRef.current)?.focus?.(),
  }));

  const attachStyle = useGridPopupPosition(rect, 340);
  const onChange = (value?: IUserCellValue | IUserCellValue[]) => {
    record.updateCell(fieldId, value, { t });
  };

  return (
    <>
      {isEditing ? (
        <UserEditorMain
          ref={editorRef}
          style={{
            ...style,
            ...attachStyle,
            height: 'auto',
            minWidth: 280,
          }}
          className="absolute rounded-sm border shadow-sm"
          value={cellValue}
          isMultiple={options.isMultiple}
          onChange={onChange}
        />
      ) : (
        <input className="size-0 opacity-0" ref={defaultFocusRef} />
      )}
    </>
  );
};

export const GridUserEditor = forwardRef(GridUserEditorBase);
