import type { INumberFieldOptions } from '@teable-group/core';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { NumberEditor } from '../../editor';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { GRID_DEFAULT } from '../../grid/configs';
import type { IWrapperEditorProps } from './type';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

const GridNumberEditorBase: ForwardRefRenderFunction<
  IEditorRef<number>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { field, record, rect, style, theme } = props;
  const { cellLineColorActived } = theme;
  const editorRef = useRef<IEditorRef<number>>(null);
  const options = field.options as INumberFieldOptions;
  const { width, height } = rect;

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    setValue: (value?: number) => editorRef.current?.setValue?.(value),
    saveValue: () => editorRef.current?.saveValue?.(),
  }));

  const saveValue = (value: unknown) => {
    record.updateCell(field.id, value ?? null);
  };

  const attachStyle = useMemo(() => {
    const style: React.CSSProperties = {
      width: width + 4,
      height: height + 4,
      marginLeft: -2,
      marginTop: -2.5,
    };
    if (height > defaultRowHeight) {
      style.paddingBottom = height - defaultRowHeight;
    }
    return style;
  }, [height, width]);

  return (
    <NumberEditor
      ref={editorRef}
      className="rounded-md border-2 text-right shadow-none focus-visible:ring-transparent"
      style={{ border: `2px solid ${cellLineColorActived}`, ...style, ...attachStyle }}
      options={options}
      onChange={saveValue}
    />
  );
};

export const GridNumberEditor = forwardRef(GridNumberEditorBase);
