import { ChevronLeft } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib/shadcn';

export const OpenRightSide: React.FC<{ onClick?(): void }> = ({ onClick }) => {
  return (
    <Button
      className="fixed top-5 right-0 z-10 rounded-r-none rounded-l-full"
      variant={'outline'}
      onClick={onClick}
      size="xs"
    >
      <ChevronLeft className="w-5 h-5" />
    </Button>
  );
};
