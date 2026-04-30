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

const toCommitValue = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed || null;
};

const getChangedCommitValue = (value: string, initialValue: string): string | null | undefined => {
  const nextValue = toCommitValue(value);
  return nextValue === toCommitValue(initialValue) ? undefined : nextValue;
};

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
  onDirtyChange,
  open,
}: {
  value: string;
  onChange?: (value: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  open: boolean;
}) => {
  const initialValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const handleMarkdownUpdated = useCallback(
    (markdown: string) => {
      onDirtyChange?.(getChangedCommitValue(markdown, initialValueRef.current) !== undefined);
    },
    [onDirtyChange]
  );

  useEditor(
    (root) =>
      createMilkdownEditor(root, {
        value,
        latestValueRef,
        onMarkdownUpdated: handleMarkdownUpdated,
      }),
    []
  );

  const [loading, getEditor] = useInstance();

  const handleBlur = useCallback(() => {
    if (!loading) {
      const markdown = getEditorMarkdown(getEditor());
      if (markdown !== undefined) {
        latestValueRef.current = markdown;
      }
    }
    const nextValue = getChangedCommitValue(latestValueRef.current, initialValueRef.current);
    if (nextValue !== undefined) {
      onChange?.(nextValue);
      initialValueRef.current = latestValueRef.current;
      onDirtyChange?.(false);
      return;
    }
    onDirtyChange?.(false);
  }, [onChange, onDirtyChange, loading, getEditor]);

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
      onInput={() => onDirtyChange?.(true)}
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
  onDirtyChange,
  open,
}: {
  value: string;
  onChange?: (value: string | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  open: boolean;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialValueRef = useRef(value);
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
    const nextValue = getChangedCommitValue(latestValueRef.current, initialValueRef.current);
    if (nextValue !== undefined) {
      onChange?.(nextValue);
      initialValueRef.current = latestValueRef.current;
      onDirtyChange?.(false);
      return;
    }
    onDirtyChange?.(false);
  }, [onChange, onDirtyChange]);

  return (
    <textarea
      ref={textareaRef}
      className="flex-1 resize-none bg-transparent pt-2 text-sm outline-none"
      defaultValue={value}
      onChange={(e) => {
        latestValueRef.current = e.target.value;
        onDirtyChange?.(
          getChangedCommitValue(e.target.value, initialValueRef.current) !== undefined
        );
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

const STORAGE_KEY = 'expand-markdown-editor-size';
const MIN_WIDTH = 560;
const MIN_HEIGHT = 400;
const MAX_RATIO = 0.8;

const getSavedSize = (): { width: number; height: number } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number' &&
      parsed.width >= MIN_WIDTH &&
      parsed.height >= MIN_HEIGHT
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
};

const saveSize = (width: number, height: number) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ width, height }));
  } catch {
    // ignore
  }
};

const clampSize = (width: number, height: number) => {
  const maxW = Math.floor(window.innerWidth * MAX_RATIO);
  const maxH = Math.floor(window.innerHeight * MAX_RATIO);
  return {
    width: Math.max(MIN_WIDTH, Math.min(width, maxW)),
    height: Math.max(MIN_HEIGHT, Math.min(height, maxH)),
  };
};

const VIEWPORT_PADDING = 12;
const SIDE_OFFSET = 4;

const calcViewportOffset = (
  triggerRect: DOMRect,
  popWidth: number,
  popHeight: number
): { x: number; y: number } => {
  const pad = VIEWPORT_PADDING;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const popLeft = triggerRect.right + SIDE_OFFSET;
  const popTop = triggerRect.top;
  const popRight = popLeft + popWidth;
  const popBottom = popTop + popHeight;

  let dx = 0;
  let dy = 0;

  if (popRight > vw - pad) dx = vw - pad - popRight;
  if (popBottom > vh - pad) dy = vh - pad - popBottom;
  if (popLeft + dx < pad) dx = pad - popLeft;
  if (popTop + dy < pad) dy = pad - popTop;

  return { x: dx, y: dy };
};

const clampToViewport = (
  el: HTMLElement | null,
  offsetRef: React.MutableRefObject<{ x: number; y: number }>,
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const pad = VIEWPORT_PADDING;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let dx = 0;
  let dy = 0;

  if (rect.right > vw - pad) dx = vw - pad - rect.right;
  if (rect.bottom > vh - pad) dy = vh - pad - rect.bottom;
  if (rect.left + dx < pad) dx = pad - rect.left;
  if (rect.top + dy < pad) dy = pad - rect.top;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    const next = {
      x: offsetRef.current.x + dx,
      y: offsetRef.current.y + dy,
    };
    offsetRef.current = next;
    setOffset(next);
  }
};

const useDrag = () => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });

  const initOffset = useCallback((value: { x: number; y: number }) => {
    offsetRef.current = value;
    setOffset(value);
  }, []);

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

  return { offset, setOffset, offsetRef, initOffset, onPointerDown, onPointerMove, onPointerUp };
};

const useResize = (open: boolean, onResizeEnd?: () => void) => {
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    const saved = getSavedSize();
    return saved ? clampSize(saved.width, saved.height) : { width: MIN_WIDTH, height: MIN_HEIGHT };
  });
  const sizeRef = useRef(size);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    if (open) {
      const saved = getSavedSize();
      const next = saved
        ? clampSize(saved.width, saved.height)
        : { width: MIN_WIDTH, height: MIN_HEIGHT };
      setSize(next);
      sizeRef.current = next;
    }
  }, [open]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = sizeRef.current.width;
      const startH = sizeRef.current.height;
      const el = (e.currentTarget as HTMLElement).parentElement;

      const handleMove = (ev: PointerEvent) => {
        const next = clampSize(startW + ev.clientX - startX, startH + ev.clientY - startY);
        sizeRef.current = next;
        if (el) {
          el.style.width = `${next.width}px`;
          el.style.height = `${next.height}px`;
        }
      };

      const handleUp = () => {
        document.removeEventListener('pointermove', handleMove);
        document.removeEventListener('pointerup', handleUp);
        const final = sizeRef.current;
        setSize(final);
        saveSize(final.width, final.height);
        onResizeEnd?.();
      };

      document.addEventListener('pointermove', handleMove);
      document.addEventListener('pointerup', handleUp);
    },
    [onResizeEnd]
  );

  return { size, onResizePointerDown };
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
  const [editorKey, setEditorKey] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const syncedValueRef = useRef(normalizeMarkdownValue(value));
  const { offset, setOffset, offsetRef, initOffset, onPointerDown, onPointerMove, onPointerUp } =
    useDrag();

  const scheduleClamp = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clampToViewport(contentRef.current, offsetRef, setOffset);
      });
    });
  }, [offsetRef, setOffset]);

  const { size, onResizePointerDown } = useResize(open, scheduleClamp);

  const normalized = normalizeMarkdownValue(value);

  useEffect(() => {
    if (!open) {
      dirtyRef.current = false;
      syncedValueRef.current = normalized;
      return;
    }

    if (dirtyRef.current || syncedValueRef.current === normalized) {
      return;
    }

    syncedValueRef.current = normalized;
    setEditorKey((key) => key + 1);
  }, [normalized, open]);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const handleEditorChange = useCallback(
    (nextValue: string | null) => {
      syncedValueRef.current = normalizeMarkdownValue(nextValue);
      onChange?.(nextValue);
    },
    [onChange]
  );

  const handleExpandClick = useCallback(() => {
    onExpandOpen?.();
    dirtyRef.current = false;
    syncedValueRef.current = normalizeMarkdownValue(value);
    const el = triggerRef.current;
    if (el) {
      const saved = getSavedSize();
      const popSize = saved
        ? clampSize(saved.width, saved.height)
        : { width: MIN_WIDTH, height: MIN_HEIGHT };
      initOffset(calcViewportOffset(el.getBoundingClientRect(), popSize.width, popSize.height));
    } else {
      initOffset({ x: 0, y: 0 });
    }
    setOpen(true);
  }, [onExpandOpen, initOffset, value]);

  const handleOpenChange = (isOpen: boolean) => {
    if (converting) return;
    if (!isOpen) {
      setMode(initialMode);
    }
    setOpen(isOpen);
  };

  const handleModeChange = async (checked: boolean) => {
    const nextMode: EditorMode = checked ? 'markdown' : 'text';
    if (!field) {
      setMode(nextMode);
      return;
    }
    setConverting(true);
    try {
      const nextOptions = {
        ...(field.options as ILongTextFieldOptions),
        showAs: nextMode === 'markdown' ? { type: 'markdown' as const } : null,
      } as ILongTextFieldOptions;
      await field.convert({
        type: FieldType.LongText,
        name: field.name,
        dbFieldName: field.dbFieldName,
        description: field.description,
        isLookup: field.isLookup,
        isConditionalLookup: field.isConditionalLookup,
        lookupOptions: field.lookupOptions,
        aiConfig: field.aiConfig,
        options: nextOptions,
      });
      setMode(nextMode);
    } finally {
      setConverting(false);
    }
  };

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
      return (
        <ExpandedTextEditorInner
          key={`text-${editorKey}`}
          value={normalized}
          onChange={handleEditorChange}
          onDirtyChange={handleDirtyChange}
          open={open}
        />
      );
    }

    return (
      <MilkdownProvider>
        <ExpandedEditorInner
          key={`markdown-${editorKey}`}
          value={normalized}
          onChange={handleEditorChange}
          onDirtyChange={handleDirtyChange}
          open={open}
        />
      </MilkdownProvider>
    );
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex size-5 items-center justify-center rounded bg-background text-muted-foreground shadow-sm ring-1 ring-border/40 hover:bg-muted hover:text-foreground"
          onClick={handleExpandClick}
          title="Expand editor"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        side="right"
        align="start"
        avoidCollisions={false}
        className="click-outside-ignore relative flex flex-col p-3"
        style={{
          width: size.width,
          height: size.height,
          maxWidth: 'none',
          translate: `${offset.x}px ${offset.y}px`,
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onCopy={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDownOutside={(e) => {
          const target = (e.detail?.originalEvent?.target ?? e.target) as HTMLElement;
          if (
            target.closest(
              '.milkdown-floating-toolbar, .milkdown-link-tooltip, .milkdown-selection-toolbar'
            )
          ) {
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
          {!readonly && field && (
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
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="group/resize absolute bottom-0 right-0 z-10 flex size-5 cursor-se-resize items-center justify-center"
          onPointerDown={onResizePointerDown}
        >
          <svg
            className="pointer-events-none text-muted-foreground/50 transition-colors group-hover/resize:text-muted-foreground"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path
              d="M9 1L1 9M9 5L5 9M9 9L9 9"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </PopoverContent>
    </Popover>
  );
};
