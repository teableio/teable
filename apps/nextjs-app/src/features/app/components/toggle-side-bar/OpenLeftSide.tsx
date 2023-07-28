import { ChevronsRight } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const OpenLeftSide: React.FC<{ onClick?(): void }> = ({ onClick }) => {
  return (
    <Button
      className="fixed top-7 left-0 z-10 rounded-l-none rounded-r-full p-1"
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronsRight className="w-5 h-5" />
    </Button>
  );
};
