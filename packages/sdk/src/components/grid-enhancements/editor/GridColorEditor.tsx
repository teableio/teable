import {
  forwardRef,
  type ForwardRefRenderFunction,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { ColorEditor } from '../../editor';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid';
import { GRID_DEFAULT } from '../../grid/configs';
import type { IWrapperEditorProps } from './type';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

const GridColorEditorBase: ForwardRefRenderFunction<
  IEditorRef<string>,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { field, record, isEditing, style, theme, rect } = props;
  const { width, height } = rect;
  const { cellLineColorActived } = theme;
  const { t } = useTranslation();
  const editorRef = useRef<IEditorRef<string>>(null);

  // Open the picker only when the user activates edit mode (double-click / Enter),
  // not on every cell navigation (which also triggers focus() via EditorContainer).
  useEffect(() => {
    if (isEditing) {
      editorRef.current?.focus?.();
    }
  }, [isEditing]);

  useImperativeHandle(ref, () => ({
    focus: () => undefined, // picker is opened by the isEditing effect above
    setValue: (value?: string) => editorRef.current?.setValue?.(value),
    saveValue: () => editorRef.current?.saveValue?.(),
  }));

  const onChangeInner = (value?: string | null) => {
    record.updateCell(field.id, value?.toUpperCase() ?? null, { t });
  };

  const cellValue = record.getCellValue(field.id) as string | undefined;

  const attachStyle = useMemo(() => {
    const style: React.CSSProperties = {
      width: width + 2,
      height: height + 2,
      marginLeft: -2,
      marginTop: -2.5,
    };
    if (height > defaultRowHeight) {
      style.paddingBottom = height - defaultRowHeight;
    }
    return style;
  }, [height, width]);

  return (
    <ColorEditor
      ref={editorRef}
      className="rounded-md border-2 text-right shadow-none focus-visible:ring-transparent"
      style={{ border: `2px solid ${cellLineColorActived}`, ...style, ...attachStyle }}
      value={cellValue ?? ''}
      onChange={onChangeInner}
      readonly={field.isComputed}
    />
  );
};

export const GridColorEditor = forwardRef(GridColorEditorBase);
