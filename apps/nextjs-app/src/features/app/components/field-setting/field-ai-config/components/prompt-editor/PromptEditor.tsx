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
import { createPortal } from 'react-dom';
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
    const handleClickOutside = (event: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(event.target as Node)) {
        setSlashMenuOpen(false);
        setSearchQuery('');
      }
    };

    if (slashMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [slashMenuOpen]);

  // Handle field selection from slash menu
  const handleSlashFieldSelect = useCallback(
    (fieldId: string) => {
      const view = actualEditorViewRef.current;
      if (!view || slashStartPosRef.current === null) return;

      const formatValue = `{${fieldId}}`;
      const currentPos = view.state.selection.main.head;
      // Replace from slash position to current position (including any search text)
      view.dispatch({
        changes: { from: slashStartPosRef.current, to: currentPos, insert: formatValue },
        selection: { anchor: slashStartPosRef.current + formatValue.length },
      });
      view.focus();

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

  // Get cursor position for slash menu placement (viewport coordinates for portal)
  const getCursorCoords = useCallback((view: EditorView) => {
    const pos = view.state.selection.main.head;
    const coords = view.coordsAtPos(pos);
    if (!coords) return null;

    // Return viewport coordinates for fixed positioning in portal
    return {
      top: coords.bottom,
      left: coords.left,
    };
  }, []);

  const onVariableDelete = useCallback(
    (from: number, to: number) => {
      if (!actualEditorViewRef.current) return;

      const view = actualEditorViewRef.current;
      view.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
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

  useEffect(() => {
    slashMenuOpenRef.current = slashMenuOpen;
    slashStartPosRef.current = slashStartPos;
  }, [slashMenuOpen, slashStartPos]);

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
        const query = text.slice(slashPos + 1, cursorPos);
        if (!slashMenuOpenRef.current) {
          const coords = getCursorCoords(view);
          if (coords) {
            setSlashMenuPosition(coords);
            setSlashMenuOpen(true);
            setSlashStartPos(slashPos);
          }
        }
        setSearchQuery(query);
      } else if (slashMenuOpenRef.current) {
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
      isLightTheme ? lightTheme(themeOptions) : darkTheme(themeOptions),
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
      const selection = editorView.state.selection;
      editorView.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
        selection,
      });
      lastValueRef.current = value;

      requestAnimationFrame(() => {
        decorateFields(editorView);
      });
    }
  }, [value, editorView, decorateFields]);

  const resizeStyles = resizable
    ? {
        resize: 'vertical' as const,
        overflow: 'auto',
        minHeight,
        maxHeight,
      }
    : undefined;

  return (
    <div className={cn('h-full', className)}>
      <div
        ref={editorRef}
        className={cn('h-full cursor-text rounded-lg border shadow-sm', resizable && 'resize-y')}
        style={resizeStyles}
      />

      {/* Slash command menu - rendered in portal for proper z-index */}
      {slashMenuOpen &&
        createPortal(
          <div
            ref={slashMenuRef}
            className="fixed z-[9999] overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
            style={{
              top: slashMenuPosition.top + 4,
              left: slashMenuPosition.left,
              minWidth: 200,
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
                      ref={
                        isSelected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined
                      }
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
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
          </div>,
          document.body
        )}
    </div>
  );
};
