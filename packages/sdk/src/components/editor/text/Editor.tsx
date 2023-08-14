import { Input } from '@teable-group/ui-lib';
import { useState } from 'react';
import type { ICellEditor } from '../type';

type ITextEditor = ICellEditor<string>;

export const TextEditor = (props: ITextEditor) => {
  const { value, onChange, className } = props;

  const [text, setText] = useState<string>(value || '');

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const onBlur = () => {
    onChange?.(text);
  };

  return <Input className={className} value={text} onChange={onChangeInner} onBlur={onBlur} />;
};
