import { BaseQueryColumnType, type IBaseQueryVo } from '@teable/openapi';
import { SelectTrigger } from '@teable/ui-lib';
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  type ChartConfig,
} from '@teable/ui-lib/shadcn';
import { useMemo, useState } from 'react';
import { ChartBar } from './chart-show/Bar';

export const ChartDisplay = (props: { data: IBaseQueryVo }) => {
  const { data } = props;
  const { rows, columns } = data;

  const [xAxis, setXAxis] = useState<string>();
  const [yAxis, setYAxis] = useState<string>();
  const [group, setGroup] = useState<string>();
  const yColumns = columns.filter(
    (column) =>
      column.type === BaseQueryColumnType.Aggregation ||
      (column.fieldSource &&
        column.fieldSource?.cellValueType === 'number' &&
        !column.fieldSource.isMultipleCellValue)
  );

  const chartConfig = useMemo(() => {
    const column = columns.find((column) => column.column === yAxis);
    if (!column) return;
    if (!group) {
      return {
        [column.column]: {
          label: column.name,
          color: 'hsl(var(--chart-1))',
        },
      };
    }
    if (!xAxis) return;
    const chartConfig: ChartConfig = {};
    rows.forEach((row) => {
      const groupValue = row[group] as string;
      if (!chartConfig[groupValue]) {
        chartConfig[groupValue] = {
          label: groupValue,
          color: `hsl(var(--chart-${Object.keys(chartConfig).length + 1}))`,
        };
      }
    });
    return chartConfig;
  }, [columns, group, rows, yAxis, xAxis]);

  const convertRows = useMemo(() => {
    if (!chartConfig || !group || !xAxis || !yAxis) return rows;
    const xAxisColumn = columns.find((column) => column.column === xAxis);
    if (!xAxisColumn) return rows;
    const rowsMap: Record<string, Record<string, unknown>> = {};

    rows.forEach((row) => {
      const groupValue = row[group] as string;
      const key = row[xAxis] as string;
      const existRow = rowsMap[key];
      if (existRow) {
        rowsMap[key] = {
          ...existRow,
          [groupValue]: row[yAxis],
        };
      } else {
        rowsMap[key] = {
          [xAxis]: row[xAxis],
          ...Object.keys(chartConfig).reduce(
            (pre, cur) => {
              pre[cur] = groupValue === cur ? (row[yAxis] as number) : 0;
              return pre;
            },
            {} as Record<string, number>
          ),
        };
      }
    });
    return Object.values(rowsMap);
  }, [chartConfig, columns, group, rows, xAxis, yAxis]);

  return (
    <div className="p-4">
      <div className="mb-4 flex gap-4">
        <div className="flex items-center gap-2">
          <Label>x</Label>
          <Select value={xAxis} onValueChange={setXAxis}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select a fruit" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((column) => (
                <SelectItem key={column.column} value={column.column}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>y</Label>
          <Select value={yAxis} onValueChange={setYAxis}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select a fruit" />
            </SelectTrigger>
            <SelectContent>
              {yColumns.map((column) => (
                <SelectItem key={column.column} value={column.column}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>Group</Label>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select a fruit" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((column) => (
                <SelectItem key={column.column} value={column.column}>
                  {column.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {chartConfig && xAxis && (
        <ChartBar xAxis={xAxis} chartData={convertRows} chartConfig={chartConfig} />
      )}
    </div>
  );
};
