import { ChevronsLeft } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const OpenRightSide: React.FC<{ onClick?(): void }> = ({ onClick }) => {
  return (
    <Button
      className="fixed top-7 right-0 z-10 rounded-r-none rounded-l-full p-1"
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronsLeft className="w-4 h-4" />
    </Button>
  );
};
