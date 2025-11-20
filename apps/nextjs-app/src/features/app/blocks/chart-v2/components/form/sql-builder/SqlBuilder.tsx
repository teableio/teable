import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { indentOnInput } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  type ViewUpdate,
} from '@codemirror/view';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@teable/next-themes';
import { getBaseTableSchema } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import { vscodeLight, vscodeDark } from '@uiw/codemirror-theme-vscode';
import React, { useEffect, useRef, useCallback } from 'react';

interface ISqlBuilderProps {
  code?: string;
  readOnly?: boolean;
  style?: React.CSSProperties;
  onChange?: (code: string) => void;
}

export const SqlBuilder: React.FC<ISqlBuilderProps> = ({
  code = '',
  style,
  readOnly = false,
  onChange,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const onChangeRef = useRef(onChange);
  const { theme } = useTheme();

  const baseId = useBaseId();

  const { data: schema } = useQuery({
    queryKey: ['base-table-schema', baseId],
    queryFn: () => getBaseTableSchema(baseId!).then((res) => res.data),
    enabled: !!baseId,
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const createExtensions = useCallback(() => {
    return [
      sql({
        dialect: PostgreSQL,
        schema: {
          ...schema,
        },
      }),
      lineNumbers(),
      highlightActiveLine(),
      indentOnInput(),
      autocompletion(),
      history(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
      ...(theme === 'dark' ? [vscodeDark] : [vscodeLight]),
      EditorState.readOnly.of(readOnly),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && onChangeRef.current) {
          const currentCode = update.state.doc.toString();
          onChangeRef.current(currentCode);
        }
      }),
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '14px',
        },
        '.cm-focused': {
          outline: 'none',
        },
        '.cm-editor': {
          height: '100%',
        },
        '.cm-scroller': {
          height: '100%',
        },
      }),
    ];
  }, [readOnly, schema, theme]);

  useEffect(() => {
    if (!editorRef.current) return;

    const startState = EditorState.create({
      doc: code,
      extensions: createExtensions(),
    });

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createExtensions]);

  useEffect(() => {
    if (!viewRef.current) return;

    const currentCode = viewRef.current.state.doc.toString();
    if (currentCode !== code) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: code,
        },
      });
    }
  }, [code]);

  return (
    <div
      ref={editorRef}
      style={{
        height: '100%',
        overflow: 'hidden',
        ...style,
      }}
    />
  );
};
