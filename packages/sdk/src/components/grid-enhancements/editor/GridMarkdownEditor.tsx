import type { ForwardRefRenderFunction } from 'react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from '../../../context/app/i18n';
import { ExpandMarkdownEditor, MarkdownLongTextEditor } from '../../editor';
import { isMarkdownShowAs, normalizeMarkdownValue } from '../../editor/long-text/utils';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { GRID_DEFAULT } from '../../grid/configs';
import type { IWrapperEditorProps } from './type';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

const scrollCaretIntoView = (container: Element, selection: Selection) => {
  if (!selection.rangeCount) return;
  const caretRect = selection.getRangeAt(0).getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  if (caretRect.bottom > containerRect.bottom) {
    container.scrollTop += caretRect.bottom - containerRect.bottom;
  } else if (caretRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - caretRect.top;
  }

  if (caretRect.right > containerRect.right) {
    container.scrollLeft += caretRect.right - containerRect.right;
  } else if (caretRect.left < containerRect.left) {
    container.scrollLeft -= containerRect.left - caretRect.left;
  }
};

const focusMarkdownEditor = (wrapperEl: HTMLDivElement, initialSearch: string | undefined) => {
  const target = wrapperEl.querySelector<HTMLElement>(
    '.milkdown-editor-wrap [contenteditable="true"]'
  );
  if (!target) return;
  target.focus();

  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  if (initialSearch) {
    document.execCommand('insertText', false, initialSearch);
  }

  requestAnimationFrame(() => {
    const scrollContainer = wrapperEl.querySelector('.milkdown-editor-wrap');
    if (scrollContainer) {
      scrollCaretIntoView(scrollContainer, selection);
    }
  });
};

const focusTextarea = (el: HTMLTextAreaElement, initialSearch: string | undefined) => {
  el.focus();
  el.selectionStart = el.selectionEnd = el.value.length;
  if (initialSearch) {
    document.execCommand('insertText', false, initialSearch);
  }
};

const getReadonlyClassName = (canExpand: boolean, base: string) =>
  `pointer-events-auto ${canExpand ? 'max-h-64 overflow-auto' : 'overflow-hidden'} ${base}`;

interface IGridMarkdownEditorProps extends IWrapperEditorProps, IEditorProps {
  readonlyExpandable?: boolean;
}

const GridMarkdownEditorBase: ForwardRefRenderFunction<
  IEditorRef<string | null>,
  IGridMarkdownEditorProps
> = (props, ref) => {
  const {
    field,
    record,
    rect,
    style,
    theme,
    cell,
    isEditing,
    isScrolling,
    setEditing,
    readonlyExpandable,
    initialSearch,
  } = props;
  const { t } = useTranslation();
  const { cellLineColorActived } = theme;
  const { width, height } = rect;
  const isReadonly = Boolean(cell.readonly);
  const canExpandReadonly = Boolean(isReadonly && readonlyExpandable);
  const isMarkdown = isMarkdownShowAs(field.options);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fallbackFocusRef = useRef<HTMLInputElement>(null);
  const [editorValue, setEditorValue] = useState(() => normalizeMarkdownValue(cell.data));
  const latestValueRef = useRef(editorValue);
  const lastSavedRef = useRef<string | null>(null);

  useEffect(() => {
    const next = normalizeMarkdownValue(cell.data);
    latestValueRef.current = next;
    lastSavedRef.current = null;
    setEditorValue(next);
  }, [cell.data]);

  const persistValue = (rawValue: string) => {
    const trimmed = rawValue.trim();
    const nextValue = trimmed || null;
    if (nextValue === cell.data) return;
    if (nextValue === lastSavedRef.current) return;
    lastSavedRef.current = nextValue;
    record.updateCell(field.id, nextValue, { t });
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!isEditing) {
        fallbackFocusRef.current?.focus?.();
        return;
      }
      if (isMarkdown && wrapperRef.current) {
        focusMarkdownEditor(wrapperRef.current, initialSearch);
      } else if (textareaRef.current) {
        focusTextarea(textareaRef.current, initialSearch);
      }
    },
    setValue: (value?: string | null) => {
      if (value === null || value === undefined) return;
      const next = normalizeMarkdownValue(value);
      latestValueRef.current = next;
      setEditorValue(next);
    },
    saveValue: () => {
      if (isReadonly) return;
      persistValue(latestValueRef.current);
    },
  }));

  const saveValue = (value: unknown) => {
    if (!isEditing || isReadonly) return;
    const normalized = normalizeMarkdownValue(value);
    latestValueRef.current = normalized;
    persistValue(normalized);
  };

  const handleExpandChange = useCallback(
    (v: string | null) => {
      const normalized = normalizeMarkdownValue(v);
      latestValueRef.current = normalized;
      setEditorValue(normalized);
      persistValue(normalized);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cell.data]
  );

  const handleEditorValueChange = useCallback((value: string) => {
    latestValueRef.current = value;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        persistValue(latestValueRef.current);
        setEditing?.(false);
        return;
      }
      if (isMarkdown || e.key !== 'Enter') return;
      if (e.shiftKey) {
        e.stopPropagation();
      } else {
        e.preventDefault();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isMarkdown, setEditing]
  );

  const attachStyle = useMemo(() => {
    const result: React.CSSProperties = {
      width: width + 4,
      minHeight: height + 4,
      marginLeft: -2,
      marginTop: -2,
    };
    if (height > defaultRowHeight) {
      result.paddingBottom = height - defaultRowHeight;
    }
    return result;
  }, [height, width]);

  return (
    <>
      {!isScrolling && (!isReadonly || canExpandReadonly) && (
        <div
          className="pointer-events-auto absolute right-1 top-1 z-10"
          style={{ marginRight: -2, marginTop: -2 }}
        >
          <ExpandMarkdownEditor
            value={editorValue}
            field={field}
            readonly={isReadonly}
            title={field.name}
            initialMode={isMarkdown ? 'markdown' : 'text'}
            onExpandOpen={() => setEditing?.(false)}
            onChange={isReadonly ? undefined : handleExpandChange}
          />
        </div>
      )}
      <div
        ref={wrapperRef}
        role="textbox"
        tabIndex={-1}
        style={{
          ...style,
          ...attachStyle,
          paddingBottom: 16,
          border: `2px solid ${cellLineColorActived}`,
        }}
        className="relative rounded-md bg-background"
        onKeyDown={handleKeyDown}
      >
        {isMarkdown && (
          <div
            className={
              isReadonly ? getReadonlyClassName(canExpandReadonly, 'rounded-md text-sm') : undefined
            }
          >
            <MarkdownLongTextEditor
              className="border-none shadow-none"
              value={editorValue}
              readonly={isReadonly}
              hideExpand
              gridMode={!isReadonly}
              onChange={isReadonly ? undefined : saveValue}
              onValueChange={handleEditorValueChange}
            />
          </div>
        )}
        {!isMarkdown && isReadonly && (
          <div
            className={getReadonlyClassName(
              canExpandReadonly,
              'rounded-md px-2 pt-1 text-[13px] leading-[1.4rem]'
            )}
          >
            <pre className="whitespace-pre-wrap break-words font-sans">{editorValue}</pre>
          </div>
        )}
        {!isMarkdown && !isReadonly && (
          <>
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded border-none bg-background px-2 pt-1 text-[13px] leading-[1.4rem] focus-visible:outline-none"
              value={editorValue}
              rows={2}
              onBlur={() => persistValue(latestValueRef.current)}
              onChange={(e) => {
                const val = e.target.value;
                latestValueRef.current = val;
                setEditorValue(val);
              }}
            />
            <div className="absolute bottom-[2px] left-0 w-full rounded-b-md bg-background pb-[2px] pr-1 text-right text-xs text-slate-400 dark:text-slate-600">
              Shift + Enter
            </div>
          </>
        )}
      </div>
      <input className="absolute size-0 opacity-0" ref={fallbackFocusRef} />
    </>
  );
};

export const GridMarkdownEditor = forwardRef(GridMarkdownEditorBase);
