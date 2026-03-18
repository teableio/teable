import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { cn } from '@teable/ui-lib';
import { useCallback, useEffect, useRef } from 'react';
import type { ICellEditor } from '../type';
import { ExpandMarkdownEditor } from './ExpandMarkdownEditor';
import { MarkdownReadonly } from './MarkdownReadonly';
import { createMilkdownEditor } from './milkdown-factory';
import { normalizeMarkdownValue } from './utils';

interface IMarkdownEditorInnerProps {
  value: string;
  className?: string;
  hideExpand?: boolean;
  gridMode?: boolean;
  onChange?: (value: string | null) => void;
  onValueChange?: (value: string) => void;
}

const MarkdownEditorInner = ({
  value,
  className,
  hideExpand,
  gridMode,
  onChange,
  onValueChange,
}: IMarkdownEditorInnerProps) => {
  const latestValueRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  const handleMarkdownUpdated = useCallback((markdown: string) => {
    onValueChangeRef.current?.(markdown);
  }, []);

  useEditor(
    (root) =>
      createMilkdownEditor(root, {
        value,
        latestValueRef,
        useFixedSelectionToolbar: gridMode,
        onMarkdownUpdated: handleMarkdownUpdated,
      }),
    [value, gridMode, handleMarkdownUpdated]
  );

  const handleBlur = useCallback(() => {
    const trimmed = latestValueRef.current.trim();
    onChange?.(trimmed || null);
  }, [onChange]);

  return (
    <div className="relative">
      <div
        className={cn(
          'milkdown-editor-wrap w-full max-h-64 overflow-auto rounded-md border bg-background dark:bg-[color-mix(in_oklab,white_5%,hsl(var(--background)))] hover:border-primary/30 text-sm focus-within:border-primary',
          className
        )}
        onBlur={handleBlur}
      >
        <Milkdown />
      </div>
      {!hideExpand && (
        <div className="absolute right-1 top-1">
          <ExpandMarkdownEditor value={latestValueRef.current} onChange={onChange} />
        </div>
      )}
    </div>
  );
};

type IMarkdownLongTextEditor = ICellEditor<string | null> & {
  hideExpand?: boolean;
  gridMode?: boolean;
  onValueChange?: (value: string) => void;
};

export const MarkdownLongTextEditor = ({
  value,
  onChange,
  className,
  readonly,
  hideExpand,
  gridMode,
  onValueChange,
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
        gridMode={gridMode}
        onChange={onChange}
        onValueChange={onValueChange}
      />
    </MilkdownProvider>
  );
};
