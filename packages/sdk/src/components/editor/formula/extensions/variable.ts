import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { EditorView, WidgetType, MatchDecorator, Decoration, ViewPlugin } from '@codemirror/view';
import colors from 'tailwindcss/colors';

class VariableWidget extends WidgetType {
  text: string | undefined;

  constructor(text: string) {
    super();
    let renderText = text[0] === '{' ? text.slice(1) : text;
    renderText = renderText[renderText.length - 1] === '}' ? renderText.slice(0, -1) : renderText;
    this.text = renderText;
  }

  eq(other: VariableWidget) {
    return this.text === other.text;
  }

  toDOM() {
    const el = document.createElement('span');
    if (!this.text) return el;

    el.style.cssText = `
    margin: 0 2px;
    border-radius: 16px;
    line-height: 20px;
    background: ${colors.violet[100]};
    color: ${colors.violet[500]};
    font-size: 13px;
    padding: 3px 8px 4px;
    user-select: none;
    `;
    el.textContent = this.text;
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

export const getVariableExtensions = (regexp: RegExp) => {
  const variableMatcher = new MatchDecorator({
    regexp,
    decoration: (match) => {
      return Decoration.replace({
        widget: new VariableWidget(match[0]),
      });
    },
  });

  const variable = ViewPlugin.fromClass(
    class {
      variables: DecorationSet;
      constructor(view: EditorView) {
        this.variables = variableMatcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.variables = variableMatcher.updateDeco(update, this.variables);
      }
    },
    {
      decorations: (instance) => instance.variables,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => {
          return view.plugin(plugin)?.variables || Decoration.none;
        }),
    }
  );

  return [variable];
};
