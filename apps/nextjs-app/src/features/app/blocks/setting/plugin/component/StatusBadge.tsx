import type { PluginStatus } from '@teable/openapi';
import { Badge, cn } from '@teable/ui-lib/shadcn';
import { useStatusStatic } from '../hooks/useStatusStatic';
import { StatusDot } from './StatusDot';

export const StatusBadge = ({
  status,
  className,
}: {
  status: PluginStatus;
  className?: string;
}) => {
  const statusStatic = useStatusStatic();
  const text = statusStatic[status];
  return (
    <Badge variant={'outline'} className={cn('gap-1.5', className)}>
      <StatusDot status={status} />
      {text}
    </Badge>
  );
};
