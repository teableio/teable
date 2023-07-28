import { ChevronRight } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const OpenLeftSide: React.FC<{ onClick?(): void }> = ({ onClick }) => {
  return (
    <Button
      className="fixed top-5 left-0 z-10 rounded-l-none rounded-r-full"
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronRight className="w-5 h-5" />
    </Button>
  );
};
