import { Input, Textarea } from '@teable-group/ui-lib';
import type { ChangeEvent, ForwardRefRenderFunction, KeyboardEvent, RefObject } from 'react';
import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { Key } from 'ts-keycode-enum';
import type { ILinkCell, INumberCell, ITextCell } from '../../renderers';
import { CellType } from '../../renderers';
import type { IEditorRef, IEditorProps } from './EditorContainer';

const TextEditorBase: ForwardRefRenderFunction<
  IEditorRef<ITextCell | INumberCell>,
  IEditorProps<ITextCell | INumberCell | ILinkCell>
> = (props, ref) => {
  const { cell, onChange, style } = props;
  const { displayData, type } = cell;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValueInner] = useState(displayData);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (value: string | number | null | undefined) => setValueInner(String(value ?? '')),
    saveValue,
  }));

  const saveValue = () => {
    if (value === displayData) return;
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

  return (
    <>
      {(cell as ITextCell)?.isWrap ? (
        <div style={{ ...style, paddingBottom: 16 }} className="relative flex flex-col rounded-md">
          <Textarea
            ref={inputRef as RefObject<HTMLTextAreaElement>}
            style={{ boxShadow: 'none' }}
            className="min-h-[80px] w-full flex-1 resize-none border-none bg-background px-2 pt-[6px] leading-[22px]"
            value={value}
            onChange={onChangeInner}
            onKeyDown={onKeyDown}
          />
          <div className="absolute bottom-0 left-0 w-full rounded-b-md bg-background pb-[2px] pr-1 text-right text-xs text-slate-400 dark:text-slate-600">
            Shift + Enter
          </div>
        </div>
      ) : (
        <Input
          ref={inputRef as RefObject<HTMLInputElement>}
          style={style}
          value={value}
          width={'100%'}
          height={'100%'}
          className="h-full w-full border-2 px-2 shadow-none focus-visible:ring-transparent"
          onChange={onChangeInner}
        />
      )}
    </>
  );
};

export const TextEditor = forwardRef(TextEditorBase);
