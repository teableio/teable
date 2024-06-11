import { cn } from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import AutoSizeTextarea from 'react-textarea-autosize';
import type { ICellEditor, IEditorRef } from '../type';

type ITextEditor = ICellEditor<string | null>;

const LongTextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ITextEditor> = (
  props,
  ref
) => {
  const { value, onChange, className, readonly, saveOnBlur = true } = props;
  const [text, setText] = useState<string>(value || '');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (value?: string) => setText(value || ''),
    saveValue,
  }));

  const onChangeInner = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const saveValue = () => {
    onChange?.(text || null);
  };

  return (
    <AutoSizeTextarea
      ref={inputRef}
      className={cn(
        'w-full resize-none rounded-md border border-input bg-background p-2 text-sm leading-6 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className
      )}
      value={text}
      minRows={2}
      maxRows={10}
      readOnly={readonly}
      onBlur={() => saveOnBlur && saveValue()}
      onChange={onChangeInner}
    />
  );
};

export const LongTextEditor = forwardRef(LongTextEditorBase);
