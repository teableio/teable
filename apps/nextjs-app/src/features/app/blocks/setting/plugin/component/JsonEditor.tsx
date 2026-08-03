/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultKeymap, historyKeymap, indentWithTab, history } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { EditorView, keymap } from '@codemirror/view';
import { isObject } from 'lodash';
import { useEffect, useRef } from 'react';

export const JsonEditor = (props: {
  value?: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
}) => {
  const { value, onChange } = props;
  const editorRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  const onBlur = () => {
    const value = editorViewRef.current?.state.toJSON().doc;
    try {
      onChange(value ? JSON.parse(value) : undefined);
    } catch (e: any) {
      console.log(e.message);
      onChange(value);
    }
  };

  useEffect(() => {
    if (!editorViewRef.current) return;
    editorViewRef.current.dispatch({
      changes: {
        from: 0,
        to: editorViewRef.current.state.doc.length,
        insert: isObject(value) ? JSON.stringify(value, null, 2) : value,
      },
    });
  }, [value]);

  useEffect(() => {
    if (!editorRef.current) return;
    editorViewRef.current = new EditorView({
      parent: editorRef.current,
      doc: isObject(value) ? JSON.stringify(value, null, 2) : value,
      extensions: [
        EditorView.theme({
          '&': {
            minHeight: '56px',
            maxHeight: '220px',
            fontSize: '13px',
            backgroundColor: 'transparent',
            padding: '0px',
          },
          '.cm-scroller': { overflow: 'auto' },
          '&.cm-focused': { outline: 'none' },
          '.cm-line': { padding: '0px', lineHeight: '20px' },
          '.cm-tooltip': {
            borderWidth: '1px',
            borderColor: 'hsl(var(--input))',
            borderRadius: 'calc(var(--radius) - 2px)',
            backgroundColor: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            fontSize: '13px',
            overflow: 'hidden',
          },
          '.cm-content': { padding: '8px 10px', caretColor: 'hsl(var(--primary))' },
        }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, indentWithTab, ...historyKeymap]),
        json(),
        history(),
        linter(jsonParseLinter()),
      ],
    });
    return () => {
      editorViewRef.current?.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={editorRef} className="rounded-md border" onBlur={onBlur} />;
};
