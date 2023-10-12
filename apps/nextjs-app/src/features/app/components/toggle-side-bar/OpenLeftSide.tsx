import { ChevronsRight } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const OpenLeftSide: React.FC<{ onClick?(): void }> = ({ onClick }) => {
  return (
    <Button
      className="fixed left-0 top-7 z-10 rounded-l-none rounded-r-full p-1"
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronsRight className="h-5 w-5" />
    </Button>
  );
};
