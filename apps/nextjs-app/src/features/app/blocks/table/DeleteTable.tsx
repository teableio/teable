import { useSpace } from '@teable-group/sdk/hooks';
import AddBoldIcon from '@teable-group/ui-lib/icons/app/ashbin.svg';
export const DeleteTable: React.FC<{ tableId: string; className: string }> = ({
  tableId,
  className,
}) => {
  const space = useSpace();
  return (
    <button
      className={className}
      onClick={() => {
        space.deleteTable(tableId);
      }}
    >
      <AddBoldIcon />
    </button>
  );
};
