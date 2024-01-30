import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@teable/ui-lib/shadcn';
import { DbConnectionPanel } from './Panel';

export const DbConnectionPanelTrigger: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Database Connection</DialogTitle>
        </DialogHeader>
        <DbConnectionPanel />
      </DialogContent>
    </Dialog>
  );
};
