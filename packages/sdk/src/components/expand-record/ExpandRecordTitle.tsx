import { X } from '@teable-group/icons';
import { Button, Separator } from '@teable-group/ui-lib';

export const ExpandRecordTitle = (props: { title?: string; onClose?: () => void }) => {
  const { title, onClose } = props;
  return (
    <div className="w-full h-12 flex items-center px-4 border-b border-solid border-border">
      <h4
        title={title}
        className="flex-1 scroll-m-20 text-xl font-semibold tracking-tight truncate"
      >
        {title || 'Unnamed record'}
      </h4>
      <Separator className="h-6 mx-4" orientation="vertical" />
      <Button variant={'ghost'} size={'xs'} onClick={onClose}>
        <X />
      </Button>
    </div>
  );
};
