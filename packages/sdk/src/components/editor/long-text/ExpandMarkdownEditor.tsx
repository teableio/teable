import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { FieldType, type ILongTextFieldOptions } from '@teable/core';
import { DraggableHandle, Loader2, LongText, Maximize2 } from '@teable/icons';
import { Popover, PopoverContent, PopoverTrigger, Switch, Label } from '@teable/ui-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Field } from '../../../model';
import { MarkdownReadonly } from './MarkdownReadonly';
import { createMilkdownEditor } from './milkdown-factory';
import { getEditorMarkdown, normalizeMarkdownValue } from './utils';

type EditorMode = 'markdown' | 'text';

interface IExpandMarkdownEditorProps {
  value: string | null;
  field?: Field;
  onChange?: (value: string | null) => void;
  readonly?: boolean;
  title?: string;
  initialMode?: EditorMode;
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

  const [loading, getEditor] = useInstance();

  const handleBlur = useCallback(() => {
    if (!loading) {
      const markdown = getEditorMarkdown(getEditor());
      if (markdown !== undefined) {
        latestValueRef.current = markdown;
      }
    }
    const trimmed = latestValueRef.current.trim();
    onChange?.(trimmed || null);
  }, [onChange, loading, getEditor]);

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
    };

    const timer = window.setTimeout(() => focusEditorToEnd(), 100);
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

const ExpandedTextEditorInner = ({
  value,
  onChange,
  open,
}: {
  value: string;
  onChange?: (value: string | null) => void;
  open: boolean;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
      el.scrollTop = 0;
    }, 100);
    return () => clearTimeout(timer);
  }, [open]);

  const handleBlur = useCallback(() => {
    const trimmed = latestValueRef.current.trim();
    onChange?.(trimmed || null);
  }, [onChange]);

  return (
    <textarea
      ref={textareaRef}
      className="flex-1 resize-none bg-transparent pt-2 text-sm outline-none"
      defaultValue={value}
      onChange={(e) => {
        latestValueRef.current = e.target.value;
      }}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
        }
      }}
    />
  );
};

const useDrag = (open: boolean) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  // Reset offset when popover reopens
  useEffect(() => {
    if (open) {
      setOffset({ x: 0, y: 0 });
      offsetRef.current = { x: 0, y: 0 };
    }
  }, [open]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    startRef.current = { x: e.clientX - offsetRef.current.x, y: e.clientY - offsetRef.current.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const next = {
      x: e.clientX - startRef.current.x,
      y: e.clientY - startRef.current.y,
    };
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return { offset, onPointerDown, onPointerMove, onPointerUp };
};

export const ExpandMarkdownEditor = ({
  value,
  field,
  onChange,
  readonly,
  title,
  initialMode = 'markdown',
  onExpandOpen,
}: IExpandMarkdownEditorProps) => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [converting, setConverting] = useState(false);
  const { offset, onPointerDown, onPointerMove, onPointerUp } = useDrag(open);

  const handleOpenChange = (isOpen: boolean) => {
    if (converting) return;
    setOpen(isOpen);
    if (!isOpen) {
      setMode(initialMode);
    }
  };

  const handleModeChange = async (checked: boolean) => {
    const nextMode: EditorMode = checked ? 'markdown' : 'text';
    if (!field) {
      setMode(nextMode);
      return;
    }
    setConverting(true);
    try {
      await field.convert({
        type: FieldType.LongText,
        options: (nextMode === 'markdown'
          ? { showAs: { type: 'markdown' } }
          : { showAs: null }) as ILongTextFieldOptions,
      });
      setMode(nextMode);
    } finally {
      setConverting(false);
    }
  };

  const normalized = normalizeMarkdownValue(value);

  const renderEditor = () => {
    if (readonly) {
      return (
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          {mode === 'markdown' ? (
            <MarkdownReadonly value={normalized} />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-sans">{normalized}</pre>
          )}
        </div>
      );
    }

    if (mode === 'text') {
      return <ExpandedTextEditorInner value={normalized} onChange={onChange} open={open} />;
    }

    return (
      <MilkdownProvider>
        <ExpandedEditorInner value={normalized} onChange={onChange} open={open} />
      </MilkdownProvider>
    );
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-5 items-center justify-center rounded bg-background text-muted-foreground shadow-sm ring-1 ring-border/40 hover:bg-muted hover:text-foreground"
          onClick={() => {
            onExpandOpen?.();
            setOpen(true);
          }}
          title="Expand editor"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="click-outside-ignore flex h-[400px] w-[560px] flex-col p-3"
        style={{ translate: `${offset.x}px ${offset.y}px` }}
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
          e.preventDefault();
        }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="flex cursor-grab items-center gap-1.5 text-sm text-muted-foreground active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <DraggableHandle className="size-4 shrink-0 opacity-50" />
          <LongText className="size-4 shrink-0" />
          <span className="truncate">{title}</span>
          <span className="ml-auto" />
          {!readonly && (
            <div
              className="flex cursor-default items-center gap-1.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {converting && <Loader2 className="size-3.5 animate-spin" />}
              <Label
                htmlFor="expand-md-switch"
                className="cursor-pointer text-xs font-normal text-muted-foreground"
              >
                Markdown
              </Label>
              <Switch
                id="expand-md-switch"
                size="sm"
                checked={mode === 'markdown'}
                disabled={converting}
                onCheckedChange={handleModeChange}
              />
            </div>
          )}
        </div>
        {renderEditor()}
      </PopoverContent>
    </Popover>
  );
};
