import { useTable } from '@teable-group/sdk/hooks';
import {
  Dialog,
  DialogTrigger,
  Button,
  DialogContent,
  DialogFooter,
  DialogClose,
} from '@teable-group/ui-lib/shadcn';
import { DynamicFieldGraph } from '../../graph/DynamicFieldGraph';
export const FieldGraph = ({ fieldId }: { fieldId: string }) => {
  const table = useTable();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={'xs'} variant={'outline'}>
          Graph
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DynamicFieldGraph tableId={table?.id as string} fieldId={fieldId} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
