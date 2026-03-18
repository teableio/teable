import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { LongText, Maximize2 } from '@teable/icons';
import { Dialog, DialogContent } from '@teable/ui-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownReadonly } from './MarkdownReadonly';
import { createMilkdownEditor } from './milkdown-factory';
import { normalizeMarkdownValue } from './utils';

interface IExpandMarkdownEditorProps {
  value: string | null;
  onChange?: (value: string | null) => void;
  readonly?: boolean;
  title?: string;
  onExpandOpen?: () => void;
}

const ExpandedEditorInner = ({
  value,
  onChange,
  open,
}: {
  value: string;
  onChange?: (value: string | null) => void;
  open: boolean;
}) => {
  const latestValueRef = useRef(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEditor((root) => createMilkdownEditor(root, { value, latestValueRef }), []);

  const handleBlur = useCallback(() => {
    const trimmed = latestValueRef.current.trim();
    onChange?.(trimmed || null);
  }, [onChange]);

  useEffect(() => {
    if (!open) return;

    let retryTimer: number | undefined;
    const focusEditorToEnd = (retry = false) => {
      const target = wrapperRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!target) {
        if (!retry) {
          retryTimer = window.setTimeout(() => focusEditorToEnd(true), 40);
        }
        return;
      }

      target.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      // Scroll the cursor into view
      requestAnimationFrame(() => {
        const scrollContainer = wrapperRef.current;
        if (!scrollContainer || !selection.rangeCount) return;
        const caretRect = selection.getRangeAt(0).getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        if (caretRect.bottom > containerRect.bottom) {
          scrollContainer.scrollTop += caretRect.bottom - containerRect.bottom;
        }
      });
    };

    // Delay focus until after the dialog entrance animation (duration-200) completes,
    // otherwise toolbar/tooltip positions are based on intermediate animation coordinates.
    const timer = window.setTimeout(() => focusEditorToEnd(), 250);
    return () => {
      clearTimeout(timer);
      if (retryTimer != null) {
        clearTimeout(retryTimer);
      }
    };
  }, [open]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={wrapperRef}
      className="milkdown-editor-wrap flex-1 overflow-auto text-sm"
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
        }
      }}
    >
      <Milkdown />
    </div>
  );
};

export const ExpandMarkdownEditor = ({
  value,
  onChange,
  readonly,
  title,
  onExpandOpen,
}: IExpandMarkdownEditorProps) => {
  const [open, setOpen] = useState(false);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
  };

  const normalized = normalizeMarkdownValue(value);

  return (
    <>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded bg-background text-muted-foreground shadow-sm ring-1 ring-border/40 hover:bg-muted hover:text-foreground"
        onClick={() => {
          (document.activeElement as HTMLElement)?.blur();
          onExpandOpen?.();
          setOpen(true);
        }}
        title="Expand editor"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="click-outside-ignore flex h-[80vh] max-w-3xl flex-col"
          overlayClassName="click-outside-ignore"
          onKeyDown={(e) => e.stopPropagation()}
          onCopy={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => {
            const target = (e.detail?.originalEvent?.target ?? e.target) as HTMLElement;
            if (target.closest('.milkdown-floating-toolbar, .milkdown-link-tooltip')) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e) => {
            const target = (e.detail?.originalEvent?.target ?? e.target) as HTMLElement;
            if (target.closest('.milkdown-floating-toolbar, .milkdown-link-tooltip')) {
              e.preventDefault();
            }
          }}
        >
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <LongText className="size-4" />
            <span>{title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Markdown</span>
          </div>
          {readonly ? (
            <div className="min-h-0 flex-1 overflow-auto text-sm">
              <MarkdownReadonly value={normalized} />
            </div>
          ) : (
            <MilkdownProvider>
              <ExpandedEditorInner value={normalized} onChange={onChange} open={open} />
            </MilkdownProvider>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
