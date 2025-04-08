import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { WidgetType } from '@codemirror/view';

export class FieldVariable extends WidgetType {
  constructor(
    readonly fieldId: string,
    readonly fieldName: string,
    readonly from: number,
    readonly to: number,
    readonly onDelete: (from: number, to: number) => void
  ) {
    super();
  }

  toDOM() {
    const container = document.createElement('span');
    container.className =
      'inline-flex h-5 items-center gap-1 rounded bg-violet-50 px-1.5 text-xs text-violet-500 cursor-default select-none hover:bg-violet-100 mx-1';
    container.setAttribute('data-field-id', this.fieldId);
    container.setAttribute('data-field-range', `${this.from},${this.to}`);
    container.style.verticalAlign = 'middle';

    const textSpan = document.createElement('span');
    textSpan.textContent = this.fieldName;
    textSpan.className = 'max-w-[120px] truncate';
    container.appendChild(textSpan);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className =
      'inline-flex items-center justify-center size-3 hover:bg-violet-200 rounded-sm transition-colors';
    deleteButton.innerHTML = `
      <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    `;
    deleteButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onDelete(this.from, this.to);
    });
    container.appendChild(deleteButton);

    return container;
  }

  eq(other: FieldVariable) {
    return (
      this.fieldId === other.fieldId &&
      this.fieldName === other.fieldName &&
      this.from === other.from &&
      this.to === other.to
    );
  }
}

export class FieldVariableNavigation {
  static findField(doc: EditorState['doc'], pos: number) {
    let start = pos;
    while (start > 0) {
      const ch = doc.slice(start - 1, start).toString();
      if (ch === '{') {
        let end = start;
        let depth = 1;
        while (end < doc.length) {
          const nextCh = doc.slice(end, end + 1).toString();
          if (nextCh === '}' && --depth === 0) {
            return { start: start - 1, end: end + 1 };
          }
          end++;
        }
      }
      start--;
    }
    return null;
  }

  static createKeymap() {
    return [
      {
        key: 'Backspace',
        run: (view: EditorView) => {
          const { from } = view.state.selection.main;
          if (from === 0) return false;

          const text = view.state.doc.toString();
          const beforeCursor = text.slice(0, from);
          const lastOpenBrace = beforeCursor.lastIndexOf('{');
          const lastCloseBrace = beforeCursor.lastIndexOf('}');

          if (lastOpenBrace > lastCloseBrace) {
            return false;
          }

          const field = this.findField(view.state.doc, from);
          if (field && field.end === from) {
            view.dispatch({
              changes: { from: field.start, to: field.end, insert: '' },
              selection: { anchor: field.start },
            });
            view.focus();
            return true;
          }

          return false;
        },
      },
      {
        key: 'ArrowLeft',
        run: (view: EditorView) => {
          const { from } = view.state.selection.main;
          const field = this.findField(view.state.doc, from);
          if (field && field.end === from) {
            view.dispatch({
              selection: { anchor: field.start },
            });
            return true;
          }
          return false;
        },
      },
      {
        key: 'ArrowRight',
        run: (view: EditorView) => {
          const { from } = view.state.selection.main;
          const text = view.state.doc.toString();
          if (text[from] === '{') {
            let depth = 1;
            let pos = from + 1;
            while (pos < text.length) {
              if (text[pos] === '}' && --depth === 0) {
                view.dispatch({
                  selection: { anchor: pos + 1 },
                });
                return true;
              }
              if (text[pos] === '{') depth++;
              pos++;
            }
          }
          return false;
        },
      },
    ];
  }
}
