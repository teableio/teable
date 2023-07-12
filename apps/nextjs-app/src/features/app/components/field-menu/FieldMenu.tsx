import { Button } from '@teable-group/ui-lib/shadcn/ui/button';

interface IFieldMenuProps {
  operations: {
    openFieldSetting: () => void;
    deleteField?: () => unknown;
  };
}

enum MenuOperation {
  EditField = 'EditField',
  DeleteField = 'DeleteField',
}

export const FieldMenu = (props: IFieldMenuProps) => {
  const { deleteField, openFieldSetting } = props.operations;

  const onClick = (key: MenuOperation) => {
    if (key === MenuOperation.EditField) {
      openFieldSetting();
      return;
    }
    if (key === MenuOperation.DeleteField) {
      deleteField?.();
    }
  };
  return (
    <ul className="rounded-box w-60 shadow-xl bg-background overflow-hidden">
      <li>
        <Button
          className="w-full font-normal text-sm border-none justify-start"
          variant={'ghost'}
          onClick={() => onClick(MenuOperation.EditField)}
        >
          Edit Field
        </Button>
      </li>
      <li>
        <Button
          className="w-full font-normal text-sm border-none justify-start"
          variant={'ghost'}
          onClick={() => onClick(MenuOperation.DeleteField)}
        >
          Delete Field
        </Button>
      </li>
    </ul>
  );
};
