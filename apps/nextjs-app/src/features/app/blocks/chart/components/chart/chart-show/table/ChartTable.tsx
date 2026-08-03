/* eslint-disable @typescript-eslint/no-explicit-any */
import { CellFormat } from '@teable/core';
import { CellValue } from '@teable/sdk';
import { TableBody, TableCell, TableHead, TableHeader, TableRow, Table } from '@teable/ui-lib';
import { useMemo } from 'react';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import type { ITableConfig } from '../../../../types';
import { sortTableColumns, tableConfigColumnsToMap } from '../../utils';

export const ChartTable = (props: { config?: ITableConfig }) => {
  const queryData = useBaseQueryData(CellFormat.Json);
  const { config } = props;
  const { columns: configColumns } = config ?? {};
  const columns = queryData?.columns;
  const configColumnMap = useMemo(() => tableConfigColumnsToMap(configColumns), [configColumns]);

  const sortedColumns = useMemo(
    () => (columns ? sortTableColumns(columns, configColumnMap) : []),
    [columns, configColumnMap]
  );

  return (
    <div className="size-full overflow-auto p-4">
      <Table>
        <TableHeader>
          <TableRow>
            {sortedColumns.map(({ column, name }) => (
              <TableHead
                style={{
                  width: configColumnMap[column]?.width
                    ? `${configColumnMap[column]?.width}px`
                    : 'auto',
                }}
                key={column}
              >
                {configColumnMap[column]?.label || name}
              </TableHead>
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
