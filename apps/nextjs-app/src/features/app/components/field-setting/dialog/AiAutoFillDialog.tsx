import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
  Button,
} from '@teable/ui-lib/shadcn';

interface IAiAutoFillDialogProps {
  open: boolean;
  title?: string | React.ReactNode;
  description?: string | React.ReactNode;
  cancelText: string;
  saveText: string;
  updateText: string;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onUpdate: () => void | Promise<void>;
}

export const AiAutoFillDialog = (props: IAiAutoFillDialogProps) => {
  const { open, title, description, cancelText, saveText, updateText, onClose, onSave, onUpdate } =
    props;

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent
        closeable={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <DialogHeader className="space-y-2">
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {cancelText}
          </Button>
          <Button size="sm" variant="secondary" onClick={onSave}>
            {saveText}
          </Button>
          <Button size="sm" onClick={onUpdate}>
            {updateText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
