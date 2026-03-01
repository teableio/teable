import {
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
} from '@teable/ui-lib';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { MarkdownWYSIWYGEditor } from './MarkdownWYSIWYGEditor';

interface IMarkdownExpandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  title?: string;
}

export const MarkdownExpandModal = (props: IMarkdownExpandModalProps) => {
  const { open, onOpenChange, value, onChange, readonly = false, title = 'Edit Content' } = props;
  const [localValue, setLocalValue] = useState(value);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (open) {
      setLocalValue(value);
    }
  }, [open, value]);

  const handleSave = useCallback(() => {
    onChange(localValue);
    onOpenChange(false);
  }, [localValue, onChange, onOpenChange]);

  const handleCancel = useCallback(() => {
    setLocalValue(value);
    onOpenChange(false);
  }, [value, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleCancel, handleSave]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 p-0',
          isFullscreen
            ? 'h-screen max-h-screen w-screen max-w-none rounded-none'
            : 'h-[85vh] max-h-[85vh] w-[90vw] max-w-4xl'
        )}
        onKeyDown={handleKeyDown}
        closeable={false}
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-base font-medium">{title}</DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="size-4" />
              ) : (
                <Maximize2 className="size-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleCancel}
              title="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden p-4">
          <MarkdownWYSIWYGEditor
            value={localValue}
            onChange={setLocalValue}
            readonly={readonly}
            className="h-full"
            minHeight="100%"
            maxHeight="100%"
          />
        </div>

        {!readonly && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <div className="text-xs text-muted-foreground">
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">Ctrl</kbd>
              {' + '}
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">S</kbd>
              {' to save, '}
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-xs">Esc</kbd>
              {' to cancel'}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
