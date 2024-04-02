import { Dialog, DialogContent, DialogTrigger } from '@teable/ui-lib/shadcn';
import { DbConnectionPanel } from './Panel';

export const DbConnectionPanelTrigger: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="p-0">
        <DbConnectionPanel className="border-none p-0 shadow-none" />
      </DialogContent>
    </Dialog>
  );
};
