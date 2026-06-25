import type { IDataDbConnectionSummaryVo } from '@teable/openapi';
import { Badge } from '@teable/ui-lib/shadcn';

export const DataDbBadge = ({ dataDb }: { dataDb?: IDataDbConnectionSummaryVo }) => {
  if (dataDb?.mode !== 'byodb') {
    return null;
  }

  const location = [dataDb.displayHost, dataDb.displayDatabase].filter(Boolean).join('/');

  return (
    <Badge
      variant="outline"
      className="shrink-0 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      title={location ? `Data DB: ${location}` : 'Data DB'}
    >
      Data DB
    </Badge>
  );
};
