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
import { useTranslation } from 'react-i18next';
import { DbTableName } from '../components/DbTableName';
import { TableDescription } from '../components/TableDescription';
import { TableName } from '../components/TableName';
dayjs.extend(relativeTime);

export const TableDetail = () => {
  const table = useTable() as ITableVo;
  const driver = useDriver();
  const [dbSchemaName] = table.dbTableName.split('.');
  const { t } = useTranslation(['table']);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('table:table.tableInfo')}</CardTitle>
        <CardDescription>{t('table:table.tableInfoDetail')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <TableName />
        <div className="flex flex-col gap-2">
          <Label>{t('table:table.schemaName')}</Label>
          <p className="text-sm text-muted-foreground">{dbSchemaName}</p>
        </div>
        <DbTableName />
        <TableDescription />
        <div className="flex flex-col gap-2">
          <Label>{t('table:table.typeOfDatabase')}</Label>
          <p className="text-sm text-muted-foreground">{driver}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('table:lastModifiedTime')}</Label>
          <p className="text-sm text-muted-foreground">
            {dayjs(table?.lastModifiedTime).fromNow()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
