import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
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
  const { field, record, rect, style, theme, cell, isEditing } = props;
  const { t } = useTranslation();
  const { cellLineColorActived } = theme;
  const editorRef = useRef<IEditorRef<number>>(null);
  const { width, height } = rect;

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus?.(),
    setValue: (value?: number) => editorRef.current?.setValue?.(value),
    saveValue: () => editorRef.current?.saveValue?.(),
  }));

  const saveValue = (value: unknown) => {
    if (value === cell.data || !isEditing) return;
    record.updateCell(field.id, value ?? null, { t });
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
      onChange={saveValue}
      saveOnBlur={false}
    />
  );
};

export const GridNumberEditor = forwardRef(GridNumberEditorBase);
