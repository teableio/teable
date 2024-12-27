import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import type { EditorSelection, Extension } from '@codemirror/state';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView, placeholder as placeholderExtension } from '@codemirror/view';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { AUTOCOMPLETE_EXTENSIONS, HISTORY_EXTENSIONS } from '../extensions';

interface ICodeEditorProps {
  value?: string;
  extensions?: Extension[];
  onChange?: (value: string) => void;
  onSelectionChange?: (value: string, selection: EditorSelection) => void;
  placeholder?: string;
}

export interface ICodeEditorRef {
  getEditorView: () => EditorView | null;
}

const emptyExtensions: Extension[] = [];

const CodeEditorBase: ForwardRefRenderFunction<ICodeEditorRef, ICodeEditorProps> = (props, ref) => {
  const {
    value = '',
    extensions = emptyExtensions,
    onChange,
    onSelectionChange,
    placeholder,
  } = props;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const isUserInput = useRef(false);

  useImperativeHandle(ref, () => ({
    getEditorView: () => editorViewRef.current,
  }));

  const allExtensions = useMemo(() => {
    const updateListener = EditorView.updateListener.of((v) => {
      if (v.docChanged) {
        isUserInput.current = true;
        const value = v.state.doc.toString();
        onChange?.(value);
      }

      if (v.selectionSet) {
        const value = v.state.doc.toString();
        const selection = v.state.selection;
        onSelectionChange?.(value, selection);
      }
    });
    const highlight = syntaxHighlighting(defaultHighlightStyle, { fallback: true });

    return [
      ...HISTORY_EXTENSIONS,
      ...AUTOCOMPLETE_EXTENSIONS,
      highlight,
      updateListener,
      EditorView.lineWrapping,
      placeholderExtension(placeholder ?? ''),
      ...extensions,
    ];
  }, [extensions, onChange, onSelectionChange, placeholder]);

  useEffect(() => {
    if (!editorRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: allExtensions,
    });

    const editorView = new EditorView({
      state,
      parent: editorRef.current,
    });
    editorViewRef.current = editorView;

    return () => {
      editorView.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editorViewRef.current && !isUserInput.current) {
      const currentValue = editorViewRef.current.state.doc.toString();
      if (currentValue !== value) {
        const transaction = editorViewRef.current.state.update({
          changes: { from: 0, to: editorViewRef.current.state.doc.length, insert: value },
        });
        editorViewRef.current.dispatch(transaction);
      }
    }
    isUserInput.current = false;
  }, [value]);

  useEffect(() => {
    editorViewRef.current?.dispatch({ effects: StateEffect.reconfigure.of(allExtensions) });
  }, [allExtensions]);

  return <div className="w-full" ref={editorRef} />;
};

export const CodeEditor = forwardRef(CodeEditorBase);
