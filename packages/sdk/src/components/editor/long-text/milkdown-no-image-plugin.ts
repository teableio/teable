import { Fragment, Slice, type Node } from '@milkdown/prose/model';
import { Plugin, PluginKey } from '@milkdown/prose/state';

export const removeImages = (fragment: Fragment): Fragment => {
  const children: Node[] = [];
  fragment.forEach((node) => {
    if (node.type.name === 'image') return;
    if (node.content.size > 0) {
      children.push(node.copy(removeImages(node.content)));
    } else {
      children.push(node);
    }
  });
  return Fragment.fromArray(children);
};

/**
 * ProseMirror plugin that prevents images in the editor.
 * - Blocks file-only pastes (e.g. screenshots)
 * - Strips image nodes via transformPasted (for default ProseMirror paste)
 * - Strips image nodes via appendTransaction (for clipboard plugin's direct dispatch)
 */
export const noImagePastePlugin = new Plugin({
  key: new PluginKey('no-image-paste'),
  props: {
    handlePaste(_view, event) {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return false;

      // Block paste if it only contains image files (e.g. screenshot paste)
      const hasFiles = clipboardData.files.length > 0;
      const hasText = clipboardData.getData('text/plain') || clipboardData.getData('text/html');
      if (hasFiles && !hasText) {
        event.preventDefault();
        return true;
      }

      return false;
    },
    transformPasted(slice) {
      return new Slice(removeImages(slice.content), slice.openStart, slice.openEnd);
    },
  },
  appendTransaction(_transactions, oldState, newState) {
    if (oldState.doc.eq(newState.doc)) return null;

    let hasImage = false;
    newState.doc.descendants((node) => {
      if (node.type.name === 'image') {
        hasImage = true;
        return false;
      }
    });
    if (!hasImage) return null;

    const tr = newState.tr;
    const positions: { from: number; to: number }[] = [];
    newState.doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
        positions.push({ from: pos, to: pos + node.nodeSize });
      }
    });
    // Delete in reverse order to avoid position shifts
    for (let i = positions.length - 1; i >= 0; i--) {
      tr.delete(positions[i]!.from, positions[i]!.to);
    }
    return tr.docChanged ? tr : null;
  },
});
