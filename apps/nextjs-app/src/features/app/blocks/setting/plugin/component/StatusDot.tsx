import { PluginStatus } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';

export const StatusDot = ({ status, className }: { status: PluginStatus; className?: string }) => {
  switch (status) {
    case PluginStatus.Developing:
      return (
        <span
          className={cn('size-1.5 rounded-full bg-gray-500', className)}
          aria-hidden="true"
        ></span>
      );
    case PluginStatus.Reviewing:
      return (
        <span
          className={cn('size-1.5 rounded-full bg-yellow-500', className)}
          aria-hidden="true"
        ></span>
      );
    case PluginStatus.Published:
      return (
        <span
          className={cn('size-1.5 rounded-full bg-emerald-500', className)}
          aria-hidden="true"
        ></span>
      );
    default:
      return <></>;
  }
};
