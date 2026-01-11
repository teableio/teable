import { useQueryState, parseAsBoolean } from 'nuqs';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldForm } from './FieldForm';

interface FieldCreateDialogProps {
  baseId: string;
  tableId: string;
  onSuccess?: () => void;
}

export function FieldCreateDialog({ baseId, tableId, onSuccess }: FieldCreateDialogProps) {
  const [isOpen, setIsOpen] = useQueryState(
    'createField',
    parseAsBoolean.withDefault(false).withOptions({ clearOnDefault: true })
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 text-xs font-normal">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Create field
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Field</DialogTitle>
          <DialogDescription>Add a new field to your table.</DialogDescription>
        </DialogHeader>
        <FieldForm
          baseId={baseId}
          tableId={tableId}
          onCancel={() => setIsOpen(false)}
          onSuccess={() => {
            setIsOpen(false);
            onSuccess?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
