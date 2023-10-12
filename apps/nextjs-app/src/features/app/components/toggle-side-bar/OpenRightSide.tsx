import { ChevronsLeft } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const OpenRightSide: React.FC<{ onClick?(): void }> = ({ onClick }) => {
  return (
    <Button
      className="fixed right-0 top-7 z-10 rounded-l-full rounded-r-none p-1"
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronsLeft className="h-5 w-5" />
    </Button>
  );
};
