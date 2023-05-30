import { Menu } from 'antd';

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
    <div className="rounded-box w-60 shadow-xl">
      <Menu
        selectable={false}
        onClick={({ key }) => onClick(key as MenuOperation)}
        items={[
          { label: 'Edit Field', key: MenuOperation.EditField },
          { label: 'Delete Field', key: MenuOperation.DeleteField },
        ]}
      />
    </div>
  );
};
