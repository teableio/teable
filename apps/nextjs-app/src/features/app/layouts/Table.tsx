import { TableProvider, ViewProvider, FieldProvider, RecordProvider } from '@teable-group/sdk';
import { GridView } from '../blocks/view/grid/GridView';
import { ViewList } from '../blocks/view/list/ViewList';

export interface ITableProps {
  tableId: string;
}

export const Table: React.FC<ITableProps> = ({ tableId }) => {
  return (
    <TableProvider tableId={tableId} fallback={<h1>loading</h1>}>
      <div className="grow flex flex-col h-full">
        <ViewProvider fallback={<h1>loading</h1>}>
          <ViewList />
          <FieldProvider fallback={<h1>loading</h1>}>
            <RecordProvider>
              <GridView />
            </RecordProvider>
          </FieldProvider>
        </ViewProvider>
      </div>
    </TableProvider>
  );
};
