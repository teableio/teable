import { type InsertNodesOptions, type SlateEditor, insertNodes } from '@udecode/plate-common';

import { ImagePlugin, type TImageElement } from '../ImagePlugin';

export const insertImage = <E extends SlateEditor>(
  editor: E,
  url: ArrayBuffer | string,
  options: InsertNodesOptions<E> = {}
) => {
  const text = { text: '' };
  const image: TImageElement = {
    children: [text],
    type: editor.getType(ImagePlugin),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    url: url as any,
  };
  insertNodes<TImageElement>(editor, image, {
    nextBlock: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(options as any),
  });
};
