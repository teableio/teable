import { Input } from '@teable-group/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

type ITextEditor = ICellEditor<string>;

const TextEditorBase: ForwardRefRenderFunction<IEditorRef<string>, ITextEditor> = (props, ref) => {
  const { value, onChange, className, disabled, style } = props;
  const [text, setText] = useState<string>(value || '');

  useImperativeHandle(ref, () => ({
    setValue: (value?: string) => setText(value || ''),
  }));

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const onBlur = () => {
    onChange?.(text);
  };

  return (
    <Input
      style={style}
      className={className}
      value={text}
      onChange={onChangeInner}
      onBlur={onBlur}
      disabled={disabled}
    />
  );
};

export const TextEditor = forwardRef(TextEditorBase);
