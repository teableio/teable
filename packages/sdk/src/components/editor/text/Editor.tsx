import { Input } from '@teable-group/ui-lib';
import { useEffect, useState } from 'react';
import type { ICellEditor } from '../type';

type ITextEditor = ICellEditor<string>;

export const TextEditor = (props: ITextEditor) => {
  const { value, onChange, className, disabled, style } = props;

  const [text, setText] = useState<string>(value || '');

  useEffect(() => {
    setText(value || '');
  }, [value]);

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
