import type { IDateFieldOptions } from '@teable/core';
import { TimeFormatting } from '@teable/core';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { DateEditorMain } from '../../editor';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { useGridPopupPosition } from '../hooks';
import type { IWrapperEditorProps } from './type';

const GridDateEditorBase: ForwardRefRenderFunction<
  IEditorRef<string>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { record, field, rect, style, setEditing } = props;
  const dateTime = record.getCellValue(field.id) as string;
  const options = field.options as IDateFieldOptions;
  const timeFormatting = options?.formatting?.time;
  const editorRef = useRef<IEditorRef<string>>(null);

  const attachStyle = useGridPopupPosition(rect);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    setValue: (value?: string) => editorRef.current?.setValue?.(value),
    saveValue: () => editorRef.current?.saveValue?.(),
  }));

  const setDateTime = useCallback(
    (selectedDayStr?: string | null) => {
      record.updateCell(field.id, selectedDayStr ?? null);
      if (timeFormatting === TimeFormatting.None) {
        setEditing?.(false);
      }
    },
    [field.id, record, setEditing, timeFormatting]
  );

  return (
    <DateEditorMain
      ref={editorRef}
      className="absolute rounded-md border bg-background"
      style={{
        ...style,
        ...attachStyle,
        maxHeight: 'auto',
      }}
      value={dateTime}
      options={options}
      onChange={setDateTime}
    />
  );
};

export const GridDateEditor = forwardRef(GridDateEditorBase);
