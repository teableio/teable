import { parseStringToNumber } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

export const NumberEditorBase: ForwardRefRenderFunction<
  IEditorRef<number>,
  ICellEditor<number | null> & { placeholder?: string }
> = (props, ref) => {
  const { value, onChange, className, readonly, style, saveOnBlur = true, placeholder } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [str, setStr] = useState<string | null>(value ? value.toString() : '');

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue,
    saveValue,
  }));

  const setValue = (value?: number) => {
    setStr(typeof value === 'number' ? value.toString() : '');
  };

  const saveValue = () => {
    onChange?.(parseStringToNumber(str));
  };

  const onChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStr(e.target.value);
  };

  return (
    <Input
      ref={inputRef}
      style={style}
      className={cn('h-10 sm:h-8', className)}
      value={str || ''}
      onChange={onChangeHandler}
      onBlur={() => saveOnBlur && saveValue()}
      readOnly={readonly}
      placeholder={placeholder}
    />
  );
};

export const NumberEditor = forwardRef(NumberEditorBase);
