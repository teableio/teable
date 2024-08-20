import { Trash2 } from '@teable/icons';
import { Button } from '@teable/ui-lib';
import { useCrud } from '../../hooks';
import type {
  IConditionItemProperty,
  IBaseConditionProps,
  IBaseFilterComponentProps,
} from '../../types';
import { FieldSelect } from './base-component/FieldSelect';
import { FieldValue } from './base-component/FieldValue';
import { OperatorSelect } from './base-component/OperatorSelect';

interface IConditionItemProps<T extends IConditionItemProperty = IConditionItemProperty>
  extends IBaseConditionProps,
    IBaseFilterComponentProps {
  value: T;
}

export const ConditionItem = <T extends IConditionItemProperty>(props: IConditionItemProps<T>) => {
  const { path, value, index } = props;
  const { onDelete } = useCrud();

  return (
    <div className="flex items-center gap-2 self-center">
      <FieldSelect path={[...path, 'field']} value={value.field} item={value} />
      <OperatorSelect path={[...path, 'operator']} value={value.operator} item={value} />
      <FieldValue path={[...path, 'value']} value={value.value} item={value} />

      <Button
        size="xs"
        variant="outline"
        className="size-8 shrink-0"
        onClick={() => {
          onDelete(path, index);
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
};
