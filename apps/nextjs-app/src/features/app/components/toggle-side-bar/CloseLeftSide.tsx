import { ChevronsLeft } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const CloseLeftSide: React.FC<{ onClick?(): void; left: number }> = ({ onClick, left }) => {
  return (
    <Button
      className="fixed top-7 left-0 z-50 rounded-full p-1"
      style={{ left: left - 13 }}
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronsLeft className="w-5 h-5" />
    </Button>
  );
};
