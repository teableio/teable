import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import type { EditorSelection, Extension } from '@codemirror/state';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ForwardRefRenderFunction } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { AUTOCOMPLETE_EXTENSIONS, HISTORY_EXTENSIONS } from '../extensions';

interface ICodeEditorProps {
  value?: string;
  extensions?: Extension[];
  onChange?: (value: string) => void;
  onSelectionChange?: (value: string, selection: EditorSelection) => void;
}

export interface ICodeEditorRef {
  getEditorView: () => EditorView | null;
}

const emptyExtensions: Extension[] = [];

const CodeEditorBase: ForwardRefRenderFunction<ICodeEditorRef, ICodeEditorProps> = (props, ref) => {
  const { value = '', extensions = emptyExtensions, onChange, onSelectionChange } = props;
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  useImperativeHandle(ref, () => ({
    getEditorView: () => editorViewRef.current,
  }));

  const allExtensions = useMemo(() => {
    const updateListener = EditorView.updateListener.of((v) => {
      if (v.docChanged) {
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
      ...extensions,
    ];
  }, [extensions, onChange, onSelectionChange]);

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
    editorViewRef.current?.dispatch({ effects: StateEffect.reconfigure.of(allExtensions) });
  }, [allExtensions]);

  return <div className="w-full" ref={editorRef} />;
};

export const CodeEditor = forwardRef(CodeEditorBase);
