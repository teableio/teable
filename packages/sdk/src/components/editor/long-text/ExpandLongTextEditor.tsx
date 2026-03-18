import { LongText, Maximize2 } from '@teable/icons';
import { Dialog, DialogContent } from '@teable/ui-lib';
import { useEffect, useRef, useState } from 'react';
import AutoSizeTextarea from 'react-textarea-autosize';

interface IExpandLongTextEditorProps {
  value: string | null;
  onChange?: (value: string | null) => void;
  readonly?: boolean;
  title?: string;
}

export const ExpandLongTextEditor = ({
  value,
  onChange,
  readonly,
  title,
}: IExpandLongTextEditorProps) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText(value || '');
    }
  }, [open, value]);

  useEffect(() => {
    if (!open || readonly) return;
    const rafId = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(rafId);
  }, [open, readonly]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !readonly) {
      onChange?.(text.trim() || null);
    }
    setOpen(isOpen);
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded bg-background text-muted-foreground shadow-sm ring-1 ring-border/40 hover:bg-muted hover:text-foreground"
        onClick={() => setOpen(true)}
        title="Expand editor"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="click-outside-ignore flex h-[80vh] max-w-3xl flex-col"
          overlayClassName="click-outside-ignore"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') {
              e.stopPropagation();
            }
          }}
          onCopy={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LongText className="size-4" />
            <span>{title}</span>
          </div>
          {readonly ? (
            <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-sm">
              {text}
            </div>
          ) : (
            <AutoSizeTextarea
              ref={textareaRef}
              className="min-h-0 flex-1 resize-none overflow-auto bg-transparent p-3 text-sm leading-6 focus-visible:outline-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
