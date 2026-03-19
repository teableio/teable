import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { ExpandLongTextEditor } from '../../editor';
import type { IEditorProps, IEditorRef as IGridEditorRef } from '../../grid/components';
import { TextEditor } from '../../grid/components/editor/TextEditor';
import type { INumberCell, ITextCell } from '../../grid/renderers';
import type { IWrapperEditorProps } from './type';

const GridLongTextEditorBase: ForwardRefRenderFunction<
  IGridEditorRef,
  IWrapperEditorProps & IEditorProps
> = (props, ref) => {
  const { field, record, cell, isEditing, isScrolling, ...rest } = props;
  const { t } = useTranslation();
  const isReadonly = Boolean(cell.readonly);
  const textEditorRef = useRef<IGridEditorRef<ITextCell | INumberCell>>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textEditorRef.current?.focus?.(),
    setValue: (value: unknown) => textEditorRef.current?.setValue?.(value as string),
    saveValue: () => textEditorRef.current?.saveValue?.(),
  }));

  return (
    <>
      {!isScrolling && !isReadonly && (
        <div
          className="pointer-events-auto absolute right-1 top-1 z-10"
          style={{ marginRight: -2, marginTop: -2 }}
        >
          <ExpandLongTextEditor
            value={(cell.data as string) || ''}
            title={field.name}
            onChange={(v) => {
              record.updateCell(field.id, v, { t });
            }}
          />
        </div>
      )}
      <TextEditor ref={textEditorRef} {...rest} cell={cell as ITextCell} isEditing={isEditing} />
    </>
  );
};

export const GridLongTextEditor = forwardRef(GridLongTextEditorBase);
