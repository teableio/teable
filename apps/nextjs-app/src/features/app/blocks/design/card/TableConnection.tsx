import { Card, CardContent, CardHeader, CardTitle } from '@teable/ui-lib/shadcn';
import { DbConnectionPanel } from '../../db-connection/Panel';

export const TableConnection = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Connection</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <DbConnectionPanel />
      </CardContent>
    </Card>
  );
};
