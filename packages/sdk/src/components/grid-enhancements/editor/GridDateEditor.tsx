import type { IDateFieldOptions } from '@teable-group/core';
import { TimeFormatting } from '@teable-group/core';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { DateEditorMain } from '../../editor';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import type { IWrapperEditorProps } from './type';

const GridDateEditorBase: ForwardRefRenderFunction<
  IEditorRef<string>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { record, field, style, setEditing } = props;
  const dateTime = record.getCellValue(field.id) as string;
  const options = field.options as IDateFieldOptions;
  const timeFormatting = options?.formatting?.time;
  const editorRef = useRef<IEditorRef<string>>(null);

  useImperativeHandle(ref, () => ({
    setValue: (value?: string) => {
      editorRef.current?.setValue?.(value);
    },
  }));

  const setDateTime = useCallback(
    (selectedDayStr?: string) => {
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
      className="rounded-md border bg-background"
      style={style}
      value={dateTime}
      options={options}
      onChange={setDateTime}
    />
  );
};

export const GridDateEditor = forwardRef(GridDateEditorBase);
