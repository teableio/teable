import { useTablePermission } from '@teable/sdk/hooks';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { DbConnectionPanel } from './Panel';

export const DbConnectionPanelTrigger: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const permissions = useTablePermission();
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Database Connection</DialogTitle>
        </DialogHeader>
        {permissions['base|create'] ? <DbConnectionPanel /> : 'Only base creator can view it'}
      </DialogContent>
    </Dialog>
  );
};
