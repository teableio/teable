import { joinBackward } from '@milkdown/prose/commands';
import { liftListItem } from '@milkdown/prose/schema-list';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';

/**
 * ProseMirror plugin for Backspace at the start of a list item that `joinBackward` can't
 * handle — e.g. the first item of a top-level list that owns a nested list. Without it no
 * keymap takes the key, the browser's native deletion runs, and the text ends up above the
 * list while an empty numbered item keeps the nested list. Lift the item out of its list
 * instead, the same as Shift-Tab.
 */
export const listItemBackspacePlugin = new Plugin({
  key: new PluginKey('list-item-backspace'),
  props: {
    handleKeyDown(view, event) {
      if (event.key !== 'Backspace') return false;

      const { state } = view;
      const { selection } = state;
      if (!(selection instanceof TextSelection) || !selection.empty) return false;

      const { $from } = selection;
      const listItemType = state.schema.nodes.list_item;
      if (!listItemType || $from.parentOffset !== 0 || $from.depth < 2) return false;
      if ($from.node(-1).type !== listItemType || $from.index(-1) !== 0) return false;

      // Leave the cases the default list keymap already handles to it.
      if (joinBackward(state)) return false;

      return liftListItem(listItemType)(state, view.dispatch);
    },
  },
});
