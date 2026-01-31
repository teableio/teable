/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { EditorView, keymap, Decoration, placeholder as cmPlaceholder } from '@codemirror/view';
import { useTheme } from '@teable/next-themes';
import { useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { darkTheme, FieldVariable, FieldVariableNavigation, lightTheme } from './extensions';
import type { IEditorThemeOptions } from './extensions/theme';

export interface IPromptEditorProps {
  value: string;
  className?: string;
  placeholder?: string;
  themeOptions?: IEditorThemeOptions;
  onChange: (value: string) => void;
  resizable?: boolean;
  minHeight?: number;
  maxHeight?: number;
  excludedFieldId?: string;
  isOptionDisabled?: (field: IFieldInstance) => boolean;
}

const addField = StateEffect.define<{
  from: number;
  to: number;
  fieldId: string;
  fieldName: string;
}>();

export type EditorViewRef = { current: EditorView | null };

export const PromptEditor = ({
  value,
  themeOptions,
  className,
  placeholder,
  editorViewRef,
  onChange,
  resizable = false,
  minHeight = 80,
  maxHeight = 400,
  excludedFieldId,
  isOptionDisabled,
}: IPromptEditorProps & {
  editorViewRef?: EditorViewRef;
}) => {
  const allFields = useFields({ withHidden: true, withDenied: true });
  const { resolvedTheme } = useTheme();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fieldStaticGetter = useFieldStaticGetter();

  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);
  const internalEditorViewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  // Slash command state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const [slashStartPos, setSlashStartPos] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const isLightTheme = resolvedTheme === 'light';
  const actualEditorViewRef = editorViewRef || internalEditorViewRef;

  // Filter fields excluding the current field
  const fields = useMemo(() => {
    return allFields.filter((f) => f.id !== excludedFieldId);
  }, [allFields, excludedFieldId]);

  // Filter fields for slash menu based on search query
  const filteredFields = useMemo(() => {
    if (!searchQuery) return fields;
    const query = searchQuery.toLowerCase();
    return fields.filter((f) => f.name.toLowerCase().includes(query));
  }, [fields, searchQuery]);

  // Reset selected index when filtered fields change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredFields]);

  // Close slash menu when clicking outside
  useEffect(() => {
    if (!slashMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      // Check if click is inside the menu
      if (slashMenuRef.current?.contains(event.target as Node)) {
        return; // Don't close if clicking inside menu
      }
      // Check if click is inside the editor
      if (editorRef.current?.contains(event.target as Node)) {
        return; // Don't close if clicking inside editor (let doc change handler manage it)
      }
      setSlashMenuOpen(false);
      setSearchQuery('');
    };

    // Use mousedown to capture before focus changes
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [slashMenuOpen]);

  // Handle field selection from slash menu
  const handleSlashFieldSelect = useCallback(
    (fieldId: string) => {
      const view = actualEditorViewRef.current;
      if (!view || slashStartPosRef.current === null) return;

      const formatValue = `{${fieldId}}`;
      const slashPos = slashStartPosRef.current;
      const cursorPos = view.state.selection.main.head;
      const docLength = view.state.doc.length;

      // Validate positions are within document bounds
      const safeSlashPos = Math.min(Math.max(0, slashPos), docLength);
      const safeCursorPos = Math.min(Math.max(0, cursorPos), docLength);
      const safeFrom = Math.min(safeSlashPos, safeCursorPos);
      const safeTo = Math.max(safeSlashPos, safeCursorPos);

      // Replace "/" and any text typed after it with the field reference
      view.dispatch({
        changes: { from: safeFrom, to: safeTo, insert: formatValue },
        selection: { anchor: safeFrom + formatValue.length },
      });
      view.focus();

      // Update refs immediately
      slashMenuOpenRef.current = false;
      slashStartPosRef.current = null;
      setSlashMenuOpen(false);
      setSearchQuery('');
      setSlashStartPos(null);
    },
    [actualEditorViewRef]
  );

  // Ref for handleSlashFieldSelect to use in keymap
  const handleSlashFieldSelectRef = useRef(handleSlashFieldSelect);
  useEffect(() => {
    handleSlashFieldSelectRef.current = handleSlashFieldSelect;
  }, [handleSlashFieldSelect]);

  // Find the nearest ancestor with a CSS transform (which changes fixed positioning context)
  const findTransformedAncestor = useCallback((element: HTMLElement | null): HTMLElement | null => {
    let current = element?.parentElement;
    while (current) {
      const style = window.getComputedStyle(current);
      const transform = style.transform || style.webkitTransform;
      if (transform && transform !== 'none') {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }, []);

  // Get cursor position for slash menu placement
  const getCursorCoords = useCallback(
    (view: EditorView) => {
      const pos = view.state.selection.main.head;
      const coords = view.coordsAtPos(pos);
      if (!coords) return null;

      const menuWidth = 220; // minWidth of the menu
      const menuPadding = 8; // padding from edge

      // Check if we're inside a transformed container (like a dialog)
      // If so, we need to adjust coordinates because position:fixed becomes relative to that container
      const transformedAncestor = findTransformedAncestor(view.dom);
      if (transformedAncestor) {
        const ancestorRect = transformedAncestor.getBoundingClientRect();
        let left = coords.left - ancestorRect.left;
        const top = coords.bottom - ancestorRect.top;

        // Constrain left position to prevent overflow
        const maxLeft = ancestorRect.width - menuWidth - menuPadding;
        if (left > maxLeft) {
          left = Math.max(menuPadding, maxLeft);
        }

        return { top, left };
      }

      // No transform, use viewport coordinates directly
      let left = coords.left;
      const maxLeft = window.innerWidth - menuWidth - menuPadding;
      if (left > maxLeft) {
        left = Math.max(menuPadding, maxLeft);
      }

      return {
        top: coords.bottom,
        left,
      };
    },
    [findTransformedAncestor]
  );

  const onVariableDelete = useCallback(
    (from: number, to: number) => {
      if (!actualEditorViewRef.current) return;

      const view = actualEditorViewRef.current;
      const docLength = view.state.doc.length;

      // Validate positions are within document bounds
      const safeFrom = Math.min(Math.max(0, from), docLength);
      const safeTo = Math.min(Math.max(0, to), docLength);

      if (safeFrom >= safeTo) return; // Nothing to delete

      view.dispatch({
        changes: { from: safeFrom, to: safeTo, insert: '' },
        selection: { anchor: safeFrom },
      });
      view.focus();
    },
    [actualEditorViewRef]
  );

  const decorateFields = useCallback(
    (view: EditorView) => {
      const effects: StateEffect<unknown>[] = [];
      const text = view.state.doc.toString();
      const fieldPattern = /\{([^}]+)\}/g;
      let match;

      while ((match = fieldPattern.exec(text)) !== null) {
        const fieldId = match[1];
        const field = fields.find((f) => f.id === fieldId);
        if (field) {
          effects.push(
            addField.of({
              from: match.index,
              to: match.index + match[0].length,
              fieldId: field.id,
              fieldName: field.name,
            })
          );
        }
      }

      if (effects.length > 0) {
        view.dispatch({ effects });
      }
    },
    [fields]
  );

  const fieldDecorationsState = useMemo(
    () =>
      StateField.define<DecorationSet>({
        create() {
          return Decoration.none;
        },
        update(decorations, tr) {
          decorations = decorations.map(tr.changes);
          for (const e of tr.effects) {
            if (e.is(addField)) {
              decorations = decorations.update({
                add: [
                  Decoration.replace({
                    widget: new FieldVariable(
                      e.value.fieldId,
                      e.value.fieldName,
                      e.value.from,
                      e.value.to,
                      onVariableDelete
                    ),
                  }).range(e.value.from, e.value.to),
                ],
              });
            }
          }
          return decorations;
        },
        provide: (f) => EditorView.decorations.from(f),
      }),
    [onVariableDelete]
  );

  // Track slash menu state in refs for use in extensions
  const slashMenuOpenRef = useRef(slashMenuOpen);
  const slashStartPosRef = useRef(slashStartPos);
  const selectedIndexRef = useRef(selectedIndex);
  const filteredFieldsRef = useRef(filteredFields);

  // Keep refs in sync with state - update synchronously for immediate access
  slashMenuOpenRef.current = slashMenuOpen;
  slashStartPosRef.current = slashStartPos;

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    filteredFieldsRef.current = filteredFields;
  }, [filteredFields]);

  // Find slash position before cursor
  const findSlashPosition = useCallback((text: string, cursorPos: number): number => {
    for (let i = cursorPos - 1; i >= 0; i--) {
      const char = text[i];
      if (char === '/') return i;
      // Stop if we hit a space, newline, or field reference
      if (char === ' ' || char === '\n' || char === '}') break;
    }
    return -1;
  }, []);

  // Handle slash menu state updates
  const handleSlashMenuUpdate = useCallback(
    (view: EditorView, text: string, cursorPos: number) => {
      const slashPos = findSlashPosition(text, cursorPos);

      if (slashPos >= 0) {
        // Extract search query from text after "/"
        const query = text.slice(slashPos + 1, cursorPos);

        if (!slashMenuOpenRef.current) {
          const coords = getCursorCoords(view);
          if (coords) {
            // Update refs immediately before state changes
            slashMenuOpenRef.current = true;
            slashStartPosRef.current = slashPos;
            setSlashMenuPosition(coords);
            setSlashMenuOpen(true);
            setSlashStartPos(slashPos);
          }
        }
        // Update search query from text typed after "/"
        setSearchQuery(query);
      } else if (slashMenuOpenRef.current) {
        slashMenuOpenRef.current = false;
        slashStartPosRef.current = null;
        setSlashMenuOpen(false);
        setSearchQuery('');
        setSlashStartPos(null);
      }
    },
    [findSlashPosition, getCursorCoords]
  );

  const extensions = useMemo(() => {
    return [
      history(),
      keymap.of([
        // Handle ArrowDown to navigate slash menu
        {
          key: 'ArrowDown',
          run: () => {
            if (slashMenuOpenRef.current) {
              const fields = filteredFieldsRef.current;
              if (fields.length > 0) {
                setSelectedIndex((prev) => Math.min(prev + 1, fields.length - 1));
              }
              return true;
            }
            return false;
          },
        },
        // Handle ArrowUp to navigate slash menu
        {
          key: 'ArrowUp',
          run: () => {
            if (slashMenuOpenRef.current) {
              setSelectedIndex((prev) => Math.max(prev - 1, 0));
              return true;
            }
            return false;
          },
        },
        // Handle Enter to select item from slash menu
        {
          key: 'Enter',
          run: () => {
            if (slashMenuOpenRef.current) {
              const fields = filteredFieldsRef.current;
              const index = selectedIndexRef.current;
              if (fields.length > 0 && index >= 0 && index < fields.length) {
                const field = fields[index];
                if (field && !(isOptionDisabled?.(field) ?? false)) {
                  handleSlashFieldSelectRef.current(field.id);
                }
              }
              return true;
            }
            return false;
          },
        },
        // Handle Escape to close slash menu
        {
          key: 'Escape',
          run: () => {
            if (slashMenuOpenRef.current) {
              setSlashMenuOpen(false);
              setSearchQuery('');
              setSlashStartPos(null);
              return true;
            }
            return false;
          },
        },
        ...defaultKeymap.filter((k) => !['Backspace', 'ArrowLeft', 'ArrowRight'].includes(k.key!)),
        ...historyKeymap,
        ...FieldVariableNavigation.createKeymap(),
      ]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      fieldDecorationsState,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          lastValueRef.current = newValue;
          onChange(newValue);
          decorateFields(update.view);

          // Handle slash menu
          const pos = update.state.selection.main.head;
          handleSlashMenuUpdate(update.view, newValue, pos);
        }
      }),
      isLightTheme
        ? lightTheme(resizable ? { ...themeOptions, height: '100%' } : themeOptions)
        : darkTheme(resizable ? { ...themeOptions, height: '100%' } : themeOptions),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      placeholder ? cmPlaceholder(placeholder) : [],
      EditorState.tabSize.of(2),
    ];
  }, [
    fieldDecorationsState,
    isLightTheme,
    themeOptions,
    placeholder,
    onChange,
    decorateFields,
    handleSlashMenuUpdate,
    isOptionDisabled,
    resizable,
  ]);

  const createEditorView = useCallback(
    (parent: HTMLElement) => {
      const view = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent,
      });

      requestAnimationFrame(() => {
        decorateFields(view);
      });

      return view;
    },
    [decorateFields, extensions, value]
  );

  useEffect(() => {
    if (!editorRef.current) return;

    const view = createEditorView(editorRef.current);
    setEditorView(view);
    actualEditorViewRef.current = view;
    lastValueRef.current = value;

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    actualEditorViewRef.current?.dispatch({ effects: StateEffect.reconfigure.of(extensions) });
  }, [actualEditorViewRef, extensions]);

  useEffect(() => {
    if (!editorView || value === lastValueRef.current) return;

    const currentDoc = editorView.state.doc.toString();
    if (currentDoc !== value) {
      const newDocLength = value.length;
      const currentSelection = editorView.state.selection.main;

      // Clamp selection to new document bounds to prevent "Selection points outside of document" error
      const safeAnchor = Math.min(Math.max(0, currentSelection.anchor), newDocLength);
      const safeHead = Math.min(Math.max(0, currentSelection.head), newDocLength);

      editorView.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
        selection: { anchor: safeAnchor, head: safeHead },
      });
      lastValueRef.current = value;

      requestAnimationFrame(() => {
        decorateFields(editorView);
      });
    }
  }, [value, editorView, decorateFields]);

  const handleContainerClick = useCallback(() => {
    editorView?.focus();
  }, [editorView]);

  const isFullHeight = themeOptions?.height === '100%';

  const resizeStyles = resizable
    ? {
        resize: 'vertical' as const,
        overflow: 'hidden',
        minHeight,
        maxHeight,
        height: minHeight,
      }
    : isFullHeight
      ? {
          height: '100%',
        }
      : {
          height: minHeight,
        };

  return (
    <div className={cn('flex h-full min-h-0 flex-1 flex-col', className)}>
      <div
        ref={editorRef}
        className={cn(
          'cursor-text rounded-lg border shadow-sm',
          resizable ? 'resize-y' : 'min-h-0 flex-1'
        )}
        style={resizeStyles}
        onClick={handleContainerClick}
      />

      {/* Slash command menu - use fixed positioning to escape overflow:hidden */}
      {slashMenuOpen && (
        <div
          ref={slashMenuRef}
          className="fixed z-[9999] overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
          style={{
            top: slashMenuPosition.top + 4,
            left: slashMenuPosition.left,
            minWidth: 220,
            maxWidth: 320,
          }}
        >
          <div className="max-h-[200px] overflow-y-auto">
            {filteredFields.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                {t('sdk:common.search.empty')}
              </div>
            ) : (
              filteredFields.map((field, index) => {
                const { Icon } = fieldStaticGetter(field.type, {
                  isLookup: field.isLookup,
                  isConditionalLookup: field.isConditionalLookup,
                  hasAiConfig: Boolean(field.aiConfig),
                  deniedReadRecord: !field.canReadFieldRecord,
                });
                const disabled = isOptionDisabled?.(field) ?? false;
                const isSelected = index === selectedIndex;

                return (
                  <div
                    key={field.id}
                    ref={isSelected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                    onClick={() => {
                      if (!disabled) {
                        handleSlashFieldSelect(field.id);
                      }
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                      isSelected && 'bg-accent',
                      disabled && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{field.name}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
