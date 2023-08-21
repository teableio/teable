import { Input } from '@teable-group/ui-lib';
import { useState } from 'react';
import type { ICellEditor } from '../type';

type INumberEditor = ICellEditor<number>;

export const NumberEditorMain = (props: INumberEditor) => {
  const { value, onChange, className, disabled, style } = props;

  const [number, setNumber] = useState<number | undefined>(value);

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
      value={number}
      onChange={onChangeInner}
      onBlur={onBlur}
      disabled={disabled}
    />
  );
};
