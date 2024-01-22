import type { ITableVo } from '@teable-group/core';
import { useDriver, useTable } from '@teable-group/sdk/hooks';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Label,
} from '@teable-group/ui-lib/shadcn';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { DbTableName } from '../components/DbTableName';
import { TableDescription } from '../components/TableDescription';
import { TableName } from '../components/TableName';
dayjs.extend(relativeTime);

export const TableDetail = () => {
  const table = useTable() as ITableVo;
  const driver = useDriver();
  const [dbSchemaName] = table.dbTableName.split('.');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Table Info</CardTitle>
        <CardDescription>Basic information for the table</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <TableName />
        <div className="flex flex-col gap-2">
          <Label>Table schema name in physical database</Label>
          <p className="text-sm text-muted-foreground">{dbSchemaName}</p>
        </div>
        <DbTableName />
        <TableDescription />
        <div className="flex flex-col gap-2">
          <Label>driver</Label>
          <p className="text-sm text-muted-foreground">{driver}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Last modified time: </Label>
          <p className="text-sm text-muted-foreground">
            {dayjs(table?.lastModifiedTime).fromNow()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
