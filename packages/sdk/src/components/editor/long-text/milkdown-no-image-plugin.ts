import { Fragment, Slice, type Node } from '@milkdown/prose/model';
import { Plugin, PluginKey } from '@milkdown/prose/state';

const removeImages = (fragment: Fragment): Fragment => {
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
 * ProseMirror plugin that prevents pasting images into the editor.
 * Strips image nodes from pasted content and blocks file-only pastes (e.g. screenshots).
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
});
