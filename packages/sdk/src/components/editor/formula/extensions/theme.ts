/* eslint-disable @typescript-eslint/naming-convention */
import { EditorView } from '@codemirror/view';
import colors from 'tailwindcss/colors';

const hexToRGBA = (hex: string, alpha = 1) => {
  let r, g, b;

  if (hex.length === 4) {
    r = '0x' + hex[1] + hex[1];
    g = '0x' + hex[2] + hex[2];
    b = '0x' + hex[3] + hex[3];
  } else if (hex.length === 7) {
    r = '0x' + hex[1] + hex[2];
    g = '0x' + hex[3] + hex[4];
    b = '0x' + hex[5] + hex[6];
  }
  if (r == null || g == null || b == null) return hex;
  return `rgba(${+r},${+g},${+b},${alpha})`;
};

const EDITOR_THEME_BASE = {
  '&': {
    minHeight: '56px',
    maxHeight: '120px',
    fontSize: '14px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
  },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-matchingBracket': { background: hexToRGBA(colors.yellow[500], 0.6) },
  '.cm-line': { padding: '0px', lineHeight: '24px' },
};

const EDITOR_LIGHT_THEME = {
  ...EDITOR_THEME_BASE,
  '.cm-content': { padding: '4px 8px', caretColor: colors.black },
};

const EDITOR_DARK_THEME = {
  ...EDITOR_THEME_BASE,
  '.cm-content': { padding: '4px 8px', caretColor: colors.white },
};

const lightTheme = EditorView.theme(EDITOR_LIGHT_THEME);
const darkTheme = EditorView.theme(EDITOR_DARK_THEME);

export const THEME_EXTENSIONS = [lightTheme, darkTheme];
