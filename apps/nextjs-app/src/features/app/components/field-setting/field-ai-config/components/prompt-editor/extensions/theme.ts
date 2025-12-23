/* eslint-disable @typescript-eslint/naming-convention */
import { EditorView } from '@codemirror/view';
import type { CSSProperties } from 'react';
import colors from 'tailwindcss/colors';

export interface IEditorThemeOptions {
  height?: string;
  content?: CSSProperties;
}

const createEditorThemeBase = (options?: IEditorThemeOptions) => ({
  '&': {
    height: options?.height ?? '120px',
    maxHeight: '320px',
    fontSize: '14px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.5',
    maxHeight: '320px',
    fontFamily:
      'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

const EDITOR_LIGHT_THEME = (options?: IEditorThemeOptions) => ({
  ...createEditorThemeBase(options),
  '.cm-content': {
    ...(options?.content ?? { padding: '8px 4px' }),
    caretColor: colors.black,
  },
  '.cm-line': {
    position: 'relative',
  },
  '.cm-placeholder': {
    position: 'absolute',
    paddingLeft: 'unset',
    fontSize: 'inherit',
  },
});

const EDITOR_DARK_THEME = (options?: IEditorThemeOptions) => ({
  ...createEditorThemeBase(options),
  '.cm-content': {
    ...(options?.content ?? { padding: '8px 4px' }),
    caretColor: colors.white,
  },
  '.cm-line': {
    position: 'relative',
  },
  '.cm-placeholder': {
    position: 'absolute',
    paddingLeft: 'unset',
    fontSize: 'inherit',
  },
});

export const lightTheme = (options?: IEditorThemeOptions) =>
  EditorView.theme(EDITOR_LIGHT_THEME(options));
export const darkTheme = (options?: IEditorThemeOptions) =>
  EditorView.theme(EDITOR_DARK_THEME(options));
