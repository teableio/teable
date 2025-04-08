import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { EditorView, keymap, Decoration } from '@codemirror/view';
import { useTheme } from '@teable/next-themes';
import { useFields } from '@teable/sdk/hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { darkTheme, FieldVariable, FieldVariableNavigation, lightTheme } from './extensions';

export interface IPromptEditorProps {
  value: string;
  height?: string;
  className?: string;
  placeholder?: string;
  onChange: (value: string) => void;
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
  height,
  placeholder,
  editorViewRef,
  onChange,
}: IPromptEditorProps & {
  editorViewRef?: EditorViewRef;
}) => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const { resolvedTheme } = useTheme();

  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);
  const internalEditorViewRef = useRef<EditorView | null>(null);
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  const isLightTheme = resolvedTheme === 'light';
  const actualEditorViewRef = editorViewRef || internalEditorViewRef;

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

  const extensions = useMemo(() => {
    return [
      history(),
      keymap.of([
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
        }
      }),
      isLightTheme ? lightTheme({ height }) : darkTheme({ height }),
      EditorView.lineWrapping,
      EditorState.allowMultipleSelections.of(true),
      placeholder ? EditorView.contentAttributes.of({ 'data-placeholder': placeholder }) : [],
      EditorState.tabSize.of(2),
    ];
  }, [fieldDecorationsState, isLightTheme, height, placeholder, onChange, decorateFields]);

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

  return (
    <div className="h-full">
      <div ref={editorRef} className="h-full cursor-text rounded-lg border shadow-sm" />
    </div>
  );
};
