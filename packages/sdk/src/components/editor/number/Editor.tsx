import { Input } from '@teable-group/ui-lib';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import type { ICellEditor, IEditorRef } from '../type';

type INumberEditor = ICellEditor<number>;

export const NumberEditorBase: ForwardRefRenderFunction<IEditorRef<number>, INumberEditor> = (
  props,
  ref
) => {
  const { value, onChange, className, disabled, style } = props;

  const [number, setNumber] = useState<number | undefined>(value);

  useImperativeHandle(ref, () => ({
    setValue: setNumber,
  }));

  const onBlur = () => {
    onChange?.(number);
  };

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numberValue = Number(e.target.value);
    setNumber(isNaN(numberValue) ? undefined : numberValue);
  };

  return (
    <Input
      style={style}
      className={className}
      value={number || ''}
      onChange={onChangeInner}
      onBlur={onBlur}
      disabled={disabled}
    />
  );
};

export const NumberEditor = forwardRef(NumberEditorBase);
