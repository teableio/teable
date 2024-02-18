import { useTablePermission } from '@teable/sdk/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { DbConnectionPanel } from '../../db-connection/Panel';

export const TableConnection = () => {
  const permissions = useTablePermission();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Connection</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {permissions['base|create'] ? <DbConnectionPanel /> : 'Only base creator can view it'}
      </CardContent>
    </Card>
  );
};
