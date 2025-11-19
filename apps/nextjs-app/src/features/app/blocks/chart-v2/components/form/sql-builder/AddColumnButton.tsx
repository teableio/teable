import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { useBaseQueryData } from '../../../chart/hooks/useBaseQueryData';
import { useStorage } from '../../../hooks';

interface IAddColumnButtonProps {
  children: React.ReactNode;
}
export const AddColumnButton = (props: IAddColumnButtonProps) => {
  const { children } = props;
  const { columns = [] } = useBaseQueryData();
  const { storage, updateStorageByPath } = useStorage();
  const yAxis = storage?.config?.yAxis;
  const selectedColumns = yAxis || [];
  const numberColumns = columns
    .filter((column) => column.isNumber)
    .filter((column) => !selectedColumns.some((selectedColumn) => selectedColumn === column.name));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        {numberColumns.map((column) => (
          <DropdownMenuItem
            key={column.name}
            onClick={() => {
              updateStorageByPath(`config.yAxis`, [...selectedColumns, column.name]);
            }}
          >
            {column.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
