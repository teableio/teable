import { formatNumberToString, parseStringToNumber } from '@teable/core';
import type { INumberFieldOptions } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

interface INumberEditor extends ICellEditor<number | null> {
  options: INumberFieldOptions;
}

export const NumberEditorBase: ForwardRefRenderFunction<IEditorRef<number>, INumberEditor> = (
  props,
  ref
) => {
  const { value, options, onChange, className, readonly, style, saveOnBlur = true } = props;
  const { formatting } = options;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [formatStr, setFormatStr] = useState<string | null>(
    formatNumberToString(value as number, formatting)
  );

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue,
    saveValue,
  }));

  const setValue = (value?: number) => {
    setFormatStr(formatNumberToString(value, formatting));
  };

  const saveValue = () => {
    const currentValue = parseStringToNumber(formatStr, formatting);
    onChange?.(currentValue);
    setFormatStr(formatNumberToString(currentValue as number, formatting));
  };

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormatStr(e.target.value);
  };

  return (
    <Input
      ref={inputRef}
      style={style}
      className={cn('h-10 sm:h-8', className)}
      value={formatStr || ''}
      onChange={onChangeInner}
      onBlur={() => saveOnBlur && saveValue()}
      disabled={readonly}
    />
  );
};

export const NumberEditor = forwardRef(NumberEditorBase);
