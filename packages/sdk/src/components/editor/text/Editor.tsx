import { Input } from '@teable-group/ui-lib';
import type { ICellEditor } from '../type';

type ITextEditor = ICellEditor<string>;

export const TextEditor = (props: ITextEditor) => {
  const { value, onChange } = props;

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e.target.value);
  };

  return <Input value={value ?? ''} onChange={onChangeInner}></Input>;
};
