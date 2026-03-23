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
import { normalizeMarkdownValue } from '../../editor/long-text/utils';
import type { IEditorRef } from '../../editor/type';
import type { IEditorProps } from '../../grid/components';
import { GRID_DEFAULT } from '../../grid/configs';
import type { IWrapperEditorProps } from './type';

const { rowHeight: defaultRowHeight } = GRID_DEFAULT;

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fallbackFocusRef = useRef<HTMLInputElement>(null);
  const [editorValue, setEditorValue] = useState(() => normalizeMarkdownValue(cell.data));
  const latestValueRef = useRef(editorValue);

  useEffect(() => {
    const next = normalizeMarkdownValue(cell.data);
    latestValueRef.current = next;
    setEditorValue(next);
  }, [cell.data]);

  const persistValue = (rawValue: string) => {
    const trimmed = rawValue.trim();
    const nextValue = trimmed || null;
    if (nextValue === cell.data) return;
    record.updateCell(field.id, nextValue, { t });
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!isEditing) {
        fallbackFocusRef.current?.focus?.();
        return;
      }
      const target = wrapperRef.current?.querySelector<HTMLElement>(
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
        const scrollContainer = wrapperRef.current?.querySelector('.milkdown-editor-wrap');
        if (!scrollContainer || !selection.rangeCount) return;
        const caretRect = selection.getRangeAt(0).getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        if (caretRect.bottom > containerRect.bottom) {
          scrollContainer.scrollTop += caretRect.bottom - containerRect.bottom;
        } else if (caretRect.top < containerRect.top) {
          scrollContainer.scrollTop -= containerRect.top - caretRect.top;
        }

        if (caretRect.right > containerRect.right) {
          scrollContainer.scrollLeft += caretRect.right - containerRect.right;
        } else if (caretRect.left < containerRect.left) {
          scrollContainer.scrollLeft -= containerRect.left - caretRect.left;
        }
      });
    },
    setValue: (value?: string | null) => {
      // When entering edit mode via keyboard (value=null), keep existing content.
      // Milkdown's useEditor re-creates the editor on value change (async),
      // clearing would cause timing issues with focus and character insertion.
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

  const handleEditorValueChange = useCallback((value: string) => {
    latestValueRef.current = value;
  }, []);

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
            onExpandOpen={() => setEditing?.(false)}
            onChange={
              isReadonly
                ? undefined
                : (v) => {
                    const normalized = normalizeMarkdownValue(v);
                    latestValueRef.current = normalized;
                    setEditorValue(normalized);
                    persistValue(normalized);
                  }
            }
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
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            persistValue(latestValueRef.current);
            setEditing?.(false);
          }
        }}
      >
        <div
          className={
            isReadonly
              ? canExpandReadonly
                ? 'pointer-events-auto max-h-64 overflow-auto rounded-md text-sm'
                : 'pointer-events-auto overflow-hidden rounded-md text-sm'
              : undefined
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
      </div>
      <input className="absolute size-0 opacity-0" ref={fallbackFocusRef} />
    </>
  );
};

export const GridMarkdownEditor = forwardRef(GridMarkdownEditorBase);
