import { Input } from '@teable-group/ui-lib';
import type { ICellEditor } from '../type';

type INumberEditor = ICellEditor<number>;

export const NumberEditorMain = (props: INumberEditor) => {
  const { value, onChange } = props;

  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numberValue = Number(e.target.value);
    onChange?.(isNaN(numberValue) ? undefined : numberValue);
  };

  return <Input value={value} onChange={onChangeInner} />;
};
