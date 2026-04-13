import type { Editor } from '@milkdown/core';
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
import AutoSizeTextarea from 'react-textarea-autosize';
import { useTranslation } from '../../../context/app/i18n';
import { ExpandMarkdownEditor, MarkdownLongTextEditor } from '../../editor';
import {
  getEditorMarkdown,
  isMarkdownShowAs,
  normalizeMarkdownValue,
} from '../../editor/long-text/utils';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { GRID_DEFAULT } from '../../grid/configs';
import type { IWrapperEditorProps } from './type';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

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

const useReadonlyScrollFix = (canScroll: boolean, cellKey: string) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = 0;
    }
  }, [cellKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !canScroll) return;

    const handleWheel = (e: WheelEvent) => {
      if (el.scrollHeight <= el.clientHeight) return;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((e.deltaY > 0 && !atBottom) || (e.deltaY < 0 && !atTop)) {
        e.stopPropagation();
      }
    };

    el.addEventListener('wheel', handleWheel);
    return () => el.removeEventListener('wheel', handleWheel);
  }, [canScroll]);

  return ref;
};

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
  const readonlyScrollRef = useReadonlyScrollFix(canExpandReadonly, record.id);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fallbackFocusRef = useRef<HTMLInputElement>(null);
  const milkdownGetEditorRef = useRef<(() => Editor) | null>(null);
  const [editorValue, setEditorValue] = useState(() => normalizeMarkdownValue(cell.data));
  const latestValueRef = useRef(editorValue);
  const savedRef = useRef(false);

  useEffect(() => {
    const next = normalizeMarkdownValue(cell.data);
    latestValueRef.current = next;
    setEditorValue(next);
    savedRef.current = false;
    milkdownGetEditorRef.current = null;
  }, [cell.data, record.id, field.id]);

  const saveValue = () => {
    if (isReadonly || savedRef.current) return;

    if (isMarkdown && milkdownGetEditorRef.current) {
      const markdown = getEditorMarkdown(milkdownGetEditorRef.current());
      if (markdown !== undefined) {
        latestValueRef.current = markdown;
      }
    }

    const trimmed = latestValueRef.current.trim();
    const nextValue = trimmed || null;
    // cell.data is '' for null values (from `(cellValue as string) || ''`), normalize both sides
    const cellData = (cell.data as string)?.trim() || null;
    if (nextValue === cellData) return;

    savedRef.current = true;
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
      const next = normalizeMarkdownValue(value);
      latestValueRef.current = next;
      setEditorValue(next);
      savedRef.current = false;
    },
    saveValue,
  }));

  const handleExpandChange = useCallback(
    (v: string | null) => {
      const normalized = normalizeMarkdownValue(v);
      latestValueRef.current = normalized;
      setEditorValue(normalized);
      const trimmed = normalized.trim();
      const nextValue = trimmed || null;
      const cellData = (cell.data as string)?.trim() || null;
      if (nextValue !== cellData) {
        record.updateCell(field.id, nextValue, { t });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record.id, field.id, cell.data]
  );

  const handleEditorValueChange = useCallback((value: string) => {
    latestValueRef.current = value;
  }, []);

  const handleEditorReady = useCallback((getEditor: () => Editor) => {
    milkdownGetEditorRef.current = getEditor;
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      saveValue();
      setEditing?.(false);
      return;
    }
    if (isMarkdown || e.key !== 'Enter') return;
    if (e.shiftKey) {
      e.stopPropagation();
    } else {
      e.preventDefault();
    }
  };

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
            key={record.id}
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
        onKeyDown={onKeyDown}
      >
        {isMarkdown && (
          <div
            ref={isMarkdown && canExpandReadonly ? readonlyScrollRef : undefined}
            className={
              isReadonly
                ? getReadonlyClassName(canExpandReadonly, 'rounded-md px-2 pt-1 text-sm')
                : undefined
            }
          >
            <MarkdownLongTextEditor
              key={`${record.id}:${field.id}`}
              className="border-none shadow-none"
              value={editorValue}
              readonly={isReadonly}
              hideExpand
              gridMode={!isReadonly}
              onValueChange={handleEditorValueChange}
              onEditorReady={isReadonly ? undefined : handleEditorReady}
            />
          </div>
        )}
        {!isMarkdown && isReadonly && (
          <div
            ref={!isMarkdown && canExpandReadonly ? readonlyScrollRef : undefined}
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
            <AutoSizeTextarea
              ref={textareaRef}
              className="w-full resize-none rounded border-none bg-background px-2 pt-1 text-[13px] leading-[1.4rem] focus-visible:outline-none"
              value={editorValue}
              minRows={2}
              maxRows={5}
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
