import type { IBaseQueryVoV2 } from '@teable/openapi';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, Table } from '@teable/ui-lib';

interface ISqlResultProps {
  data: IBaseQueryVoV2;
}
export const SqlResult = (props: ISqlResultProps) => {
  const { data: queryData } = props;
  if (!queryData) return null;

  const { columns } = queryData;

  return (
    <div className="size-full overflow-auto p-4">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            {columns.map(({ name }) => (
              <TableHead key={name} className="bg-background">
                {name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {queryData?.result.slice(0, 50).map((row, index) => (
            <TableRow key={index}>
              {columns.map(({ name }) => (
                <TableCell key={name}>
                  <span>{JSON.stringify(row[name]).toString()}</span>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
