import { type ITableVo } from '@teable/openapi';
import { useTable, useLanDayjs } from '@teable/sdk/hooks';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Label,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEnv } from '@/features/app/hooks/useEnv';
import { DbTableName } from '../components/DbTableName';
import { TableDescription } from '../components/TableDescription';
import { TableName } from '../components/TableName';

export const TableDetail = () => {
  const table = useTable() as ITableVo;
  const [dbSchemaName] = table.dbTableName.split('.');
  const { t } = useTranslation(['table']);
  const dayjs = useLanDayjs();
  const { driver } = useEnv();

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
