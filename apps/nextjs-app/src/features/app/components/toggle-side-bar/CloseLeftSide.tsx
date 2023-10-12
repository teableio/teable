import { ChevronsLeft } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const CloseLeftSide: React.FC<{ onClick?(): void; left: number }> = ({ onClick, left }) => {
  return (
    <Button
      className="fixed left-0 top-7 z-50 rounded-full p-1"
      style={{ left: left - 13 }}
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronsLeft className="h-5 w-5" />
    </Button>
  );
};
