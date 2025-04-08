/* eslint-disable @typescript-eslint/naming-convention */
import { EditorView } from '@codemirror/view';
import colors from 'tailwindcss/colors';

interface IEditorThemeOptions {
  height?: string;
}

const createEditorThemeBase = (options?: IEditorThemeOptions) => ({
  '&': {
    height: options?.height || '120px',
    fontSize: '14px',
    maxHeight: '320px',
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
    padding: '8px 4px',
    minHeight: options?.height || '120px',
    caretColor: colors.black,
  },
});

const EDITOR_DARK_THEME = (options?: IEditorThemeOptions) => ({
  ...createEditorThemeBase(options),
  '.cm-content': {
    padding: '8px 4px',
    minHeight: options?.height || '120px',
    caretColor: colors.white,
  },
});

export const lightTheme = (options?: IEditorThemeOptions) =>
  EditorView.theme(EDITOR_LIGHT_THEME(options));
export const darkTheme = (options?: IEditorThemeOptions) =>
  EditorView.theme(EDITOR_DARK_THEME(options));
