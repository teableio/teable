import { Textarea, cn } from '@teable-group/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

type ITextEditor = ICellEditor<string | null>;

const LongTextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ITextEditor> = (
  props,
  ref
) => {
  const { value, onChange, className, disabled, style } = props;
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
    onChange?.(text);
  };

  const onBlur = () => {
    onChange?.(text);
  };

  return (
    <Textarea
      ref={inputRef}
      style={style}
      className={cn('bg-background resize-none', className)}
      value={text}
      onChange={onChangeInner}
      onBlur={onBlur}
      disabled={disabled}
    />
  );
};

export const LongTextEditor = forwardRef(LongTextEditorBase);
