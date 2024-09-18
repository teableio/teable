/* eslint-disable @typescript-eslint/no-explicit-any */
import { CellFormat } from '@teable/core';
import { CellValue } from '@teable/sdk';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, Table } from '@teable/ui-lib';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';

export const ChartTable = () => {
  const queryData = useBaseQueryData(CellFormat.Json);

  return (
    <div className="size-full overflow-auto p-4">
      <Table>
        <TableHeader>
          <TableRow>
            {queryData?.columns.map(({ column, name }) => (
              <TableHead key={column}>{name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {queryData?.rows.slice(0, 50).map((row, index) => (
            <TableRow key={index}>
              {queryData.columns.map(({ column, fieldSource }) => (
                <TableCell key={column}>
                  {fieldSource ? (
                    <CellValue
                      formatImageUrl={(url) => url}
                      field={fieldSource as any}
                      value={row[column]}
                    />
                  ) : (
                    `${row[column]}`
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
