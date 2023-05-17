interface IFieldMenuProps {
  operations: {
    openFieldSetting: () => void;
    deleteField?: () => unknown;
  };
}

export const FieldMenu = (props: IFieldMenuProps) => {
  const { deleteField, openFieldSetting } = props.operations;
  return (
    <ul className="menu bg-base-100 w-60 p-2 rounded-box shadow-xl">
      <li>
        <button className="text-sm py-1" onClick={openFieldSetting}>
          Edit Field
        </button>
      </li>
      <div className="bg-base-content opacity-10 my-1 h-px" />
      <li>
        <button className="text-sm text-error py-1" onClick={deleteField}>
          Delete Field
        </button>
      </li>
    </ul>
  );
};
