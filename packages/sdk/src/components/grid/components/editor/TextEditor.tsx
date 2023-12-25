import { Input, Textarea } from '@teable-group/ui-lib';
import type { ChangeEvent, ForwardRefRenderFunction, KeyboardEvent, RefObject } from 'react';
import { useState, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { Key } from 'ts-keycode-enum';
import { GRID_DEFAULT } from '../../configs';
import type { ILinkCell, INumberCell, ITextCell } from '../../renderers';
import { CellType } from '../../renderers';
import type { IEditorRef, IEditorProps } from './EditorContainer';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

const TextEditorBase: ForwardRefRenderFunction<
  IEditorRef<ITextCell | INumberCell>,
  IEditorProps<ITextCell | INumberCell | ILinkCell>
> = (props, ref) => {
  const { cell, rect, style, theme, isEditing, onChange } = props;
  const { cellLineColorActived } = theme;
  const { width, height } = rect;
  const { displayData, type } = cell;
  const needWrap = (cell as ITextCell)?.isWrap;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValueInner] = useState(displayData);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (value: string | number | null | undefined) => setValueInner(String(value ?? '')),
    saveValue,
  }));

  const saveValue = () => {
    if (value === displayData || !isEditing) return;
    onChange?.(type === CellType.Number ? Number(value) : value);
  };

  const onChangeInner = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setValueInner(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const { keyCode, shiftKey } = event;
    if (keyCode === Key.Enter && !shiftKey) {
      event.preventDefault();
    }
    if (keyCode === Key.Enter && shiftKey) {
      event.stopPropagation();
    }
  };

  const attachStyle = useMemo(() => {
    const style: React.CSSProperties = {
      width: width + 4,
      height: needWrap ? Math.max(84, height + 4) : height + 4,
      marginLeft: -2,
      marginTop: -2.5,
      textAlign: type === CellType.Number ? 'right' : 'left',
    };
    if (height > defaultRowHeight) {
      style.paddingBottom = height - defaultRowHeight;
    }
    return style;
  }, [type, height, width, needWrap]);

  return (
    <>
      {needWrap ? (
        <div
          style={{ ...style, ...attachStyle, paddingBottom: 16 }}
          className="relative flex flex-col rounded-md"
        >
          <Textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            style={{ boxShadow: 'none' }}
            className="min-h-[80px] w-full flex-1 resize-none rounded border-none bg-background px-2 pt-[6px] leading-[22px]"
            value={value}
            onChange={onChangeInner}
            onKeyDown={onKeyDown}
            onBlur={saveValue}
          />
          <div className="absolute bottom-0 left-0 w-full rounded-b-md bg-background pb-[2px] pr-1 text-right text-xs text-slate-400 dark:text-slate-600">
            Shift + Enter
          </div>
        </div>
      ) : (
        <Input
          ref={inputRef as RefObject<HTMLInputElement>}
          style={{
            border: `2px solid ${cellLineColorActived}`,
            ...style,
            ...attachStyle,
          }}
          value={value}
          className="cursor-text border-2 px-2 shadow-none focus-visible:ring-transparent"
          onChange={onChangeInner}
          onBlur={saveValue}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
    </>
  );
};

export const TextEditor = forwardRef(TextEditorBase);
