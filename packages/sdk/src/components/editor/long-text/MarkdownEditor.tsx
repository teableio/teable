import type { Editor } from '@milkdown/core';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { cn, MarkdownReadonly } from '@teable/ui-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ICellEditor } from '../type';
import { ExpandMarkdownEditor } from './ExpandMarkdownEditor';
import { createMilkdownEditor } from './milkdown-factory';
import { getEditorMarkdown, normalizeMarkdownValue } from './utils';

interface IMarkdownEditorInnerProps {
  value: string;
  className?: string;
  hideExpand?: boolean;
  hideMarkdownBadge?: boolean;
  placeholder?: string;
  gridMode?: boolean;
  onChange?: (value: string | null) => void;
  onValueChange?: (value: string) => void;
  onEditorReady?: (getEditor: () => Editor) => void;
}

const MarkdownEditorInner = ({
  value,
  className,
  hideExpand,
  hideMarkdownBadge,
  placeholder,
  gridMode,
  onChange,
  onValueChange,
  onEditorReady,
}: IMarkdownEditorInnerProps) => {
  const initialValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [stableValue, setStableValue] = useState(value);

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  // Propagate external value changes (expand popup save, remote sync) into the
  // editor. Skip while the user is typing here so we don't discard in-flight
  // input (T3919/T3922). Skip when value already matches the editor's content
  // to avoid rebuilding after the user's own commit echoes back as a prop.
  useEffect(() => {
    if (value === latestValueRef.current) return;
    if (wrapperRef.current?.contains(document.activeElement)) return;
    initialValueRef.current = value;
    latestValueRef.current = value;
    setStableValue(value);
  }, [value]);

  const handleMarkdownUpdated = useCallback((markdown: string) => {
    onValueChangeRef.current?.(markdown);
  }, []);

  useEditor(
    (root) =>
      createMilkdownEditor(root, {
        value: stableValue,
        placeholder,
        latestValueRef,
        useFixedSelectionToolbar: gridMode,
        onMarkdownUpdated: handleMarkdownUpdated,
      }),
    [stableValue, placeholder]
  );

  const [loading, getEditor] = useInstance();

  useEffect(() => {
    if (!loading) {
      onEditorReady?.(getEditor as () => Editor);
    }
  }, [loading, getEditor, onEditorReady]);

  const handleBlur = useCallback(() => {
    if (!loading) {
      const markdown = getEditorMarkdown(getEditor());
      if (markdown !== undefined) {
        latestValueRef.current = markdown;
        onValueChangeRef.current?.(markdown);
      }
    }
    const trimmed = latestValueRef.current.trim();
    if (trimmed === initialValueRef.current.trim()) return;
    onChange?.(trimmed || null);
  }, [onChange, loading, getEditor]);

  return (
    <div className="relative">
      <div
        ref={wrapperRef}
        className={cn(
          'milkdown-editor-wrap w-full max-h-64 overflow-auto rounded-md border bg-background hover:border-primary/30 text-sm focus-within:border-primary',
          !gridMode && 'dark:bg-[color-mix(in_oklab,white_5%,hsl(var(--background)))]',
          className
        )}
        onBlur={handleBlur}
      >
        <Milkdown />
      </div>
      {!hideExpand && (
        <div className="absolute right-1 top-1">
          <ExpandMarkdownEditor value={value} onChange={onChange} />
        </div>
      )}
      {hideExpand && !hideMarkdownBadge && !gridMode && (
        <span
          className="absolute bottom-1.5 right-2 select-none rounded-sm bg-foreground/80 px-1 py-px text-[9px] font-semibold tracking-wide text-background backdrop-blur-sm"
          title="Markdown enabled"
        >
          MD
        </span>
      )}
    </div>
  );
};

type IMarkdownLongTextEditor = ICellEditor<string | null> & {
  hideExpand?: boolean;
  hideMarkdownBadge?: boolean;
  placeholder?: string;
  gridMode?: boolean;
  onValueChange?: (value: string) => void;
  onEditorReady?: (getEditor: () => Editor) => void;
};

export const MarkdownLongTextEditor = ({
  value,
  onChange,
  className,
  readonly,
  hideExpand,
  hideMarkdownBadge,
  placeholder,
  gridMode,
  onValueChange,
  onEditorReady,
}: IMarkdownLongTextEditor) => {
  const normalized = normalizeMarkdownValue(value);

  if (readonly) {
    return <MarkdownReadonly value={normalized} className={className} />;
  }

  return (
    <MilkdownProvider>
      <MarkdownEditorInner
        value={normalized}
        className={className}
        hideExpand={hideExpand}
        hideMarkdownBadge={hideMarkdownBadge}
        placeholder={placeholder}
        gridMode={gridMode}
        onChange={onChange}
        onValueChange={onValueChange}
        onEditorReady={onEditorReady}
      />
    </MilkdownProvider>
  );
};
