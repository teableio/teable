import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';

/**
 * ProseMirror plugin that handles exiting code blocks:
 * - Mod-Enter: Exit code block, create paragraph after it.
 * - Enter on an empty trailing line: Remove the empty line and exit code block.
 */
export const exitCodeBlockPlugin = new Plugin({
  key: new PluginKey('exit-code-block'),
  props: {
    handleKeyDown(view, event) {
      if (event.key !== 'Enter') return false;

      const { state } = view;
      const { selection } = state;
      const { $from } = selection;

      if ($from.parent.type.name !== 'code_block') return false;

      const isModEnter = event.metaKey || event.ctrlKey;
      const codeBlock = $from.parent;
      const isAtEnd = $from.parentOffset === codeBlock.content.size;
      const text = codeBlock.textContent;
      const isEmptyTrailingLine = isAtEnd && text.endsWith('\n');

      if (!isModEnter && !isEmptyTrailingLine) return false;

      event.preventDefault();

      const tr = state.tr;
      const posAfterCodeBlock = $from.after();
      const paragraphType = state.schema.nodes.paragraph;

      if (isEmptyTrailingLine && !isModEnter) {
        // Remove the trailing newline
        tr.delete($from.pos - 1, $from.pos);
        // Insert paragraph after code block (adjusted position due to deletion)
        tr.insert(posAfterCodeBlock - 1, paragraphType.create());
        const resolved = tr.doc.resolve(posAfterCodeBlock);
        tr.setSelection(TextSelection.near(resolved));
      } else {
        // Mod-Enter: just insert paragraph after and move cursor
        tr.insert(posAfterCodeBlock, paragraphType.create());
        const resolved = tr.doc.resolve(posAfterCodeBlock + 1);
        tr.setSelection(TextSelection.near(resolved));
      }

      view.dispatch(tr.scrollIntoView());
      return true;
    },
  },
});
