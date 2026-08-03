import type { INumberFormatting } from '@teable/core';
import { NumberFormattingType, parseStringToNumber } from '@teable/core';
import { Input, cn } from '@teable/ui-lib';
import { isNumber } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

const toDisplayStr = (value: number | null | undefined, isPercent: boolean): string => {
  if (!isNumber(value)) return '';
  return isPercent ? parseFloat((value * 100).toPrecision(15)).toString() : value.toString();
};

export const NumberEditorBase: ForwardRefRenderFunction<
  IEditorRef<number>,
  ICellEditor<number | null> & {
    placeholder?: string;
    saveOnChange?: boolean;
    formatting?: INumberFormatting;
  }
> = (props, ref) => {
  const {
    value,
    onChange,
    className,
    readonly,
    style,
    saveOnBlur = true,
    saveOnChange = false,
    placeholder,
    formatting,
  } = props;
  const isPercent = formatting?.type === NumberFormattingType.Percent;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [str, setStr] = useState<string | null>(toDisplayStr(value, isPercent));

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue,
    saveValue,
  }));

  const setValue = (value?: number) => {
    setStr(typeof value === 'number' ? toDisplayStr(value, isPercent) : '');
  };

  const saveValue = () => {
    onChange?.(parseStringToNumber(str, formatting));
  };

  const onChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setStr(newValue);
    saveOnChange && onChange?.(parseStringToNumber(newValue, formatting));
  };

  return (
    <Input
      ref={inputRef}
      style={style}
      className={cn('h-10 sm:h-8', className)}
      value={str || ''}
      onChange={onChangeHandler}
      onBlur={() => saveOnBlur && !saveOnChange && saveValue()}
      readOnly={readonly}
      placeholder={placeholder}
    />
  );
};

export const NumberEditor = forwardRef(NumberEditorBase);
