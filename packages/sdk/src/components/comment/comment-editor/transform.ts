import { CommentNodeType } from '@teable/openapi';
import type { ICommentContent, IParagraphCommentContent } from '@teable/openapi';
import type { JSONContent } from '@tiptap/core';

export const COMMENT_IMAGE_NODE = 'commentImage';
export const COMMENT_MENTION_NODE = 'commentMention';

type IParagraphChild = IParagraphCommentContent['children'][number];

const LINK_MARK = 'link';

const pushText = (children: IParagraphChild[], value: string) => {
  const last = children[children.length - 1];
  if (last?.type === CommentNodeType.Text) {
    last.value += value;
    return;
  }
  children.push({ type: CommentNodeType.Text, value });
};

const pushLink = (children: IParagraphChild[], url: string, title: string) => {
  // a link the editor split into several text nodes is still one link
  const last = children[children.length - 1];
  if (last?.type === CommentNodeType.Link && last.url === url) {
    last.title += title;
    return;
  }
  children.push({ type: CommentNodeType.Link, url, title });
};

const paragraphToComment = (node: JSONContent): IParagraphCommentContent => {
  const children: IParagraphChild[] = [];

  for (const child of node.content ?? []) {
    if (child.type === 'text' && child.text) {
      const href = child.marks?.find((mark) => mark.type === LINK_MARK)?.attrs?.href;
      if (typeof href === 'string' && href) {
        pushLink(children, href, child.text);
      } else {
        pushText(children, child.text);
      }
    } else if (child.type === 'hardBreak') {
      pushText(children, '\n');
    } else if (child.type === COMMENT_MENTION_NODE && child.attrs?.id) {
      children.push({ type: CommentNodeType.Mention, value: child.attrs.id });
    }
  }

  return { type: CommentNodeType.Paragraph, children };
};

const isBlankParagraph = (block: ICommentContent[number]) =>
  block.type === CommentNodeType.Paragraph &&
  block.children.every((child) => child.type === CommentNodeType.Text && !child.value.trim());

export const editorDocToComment = (doc: JSONContent): ICommentContent => {
  const blocks: ICommentContent = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') {
      blocks.push(paragraphToComment(node));
      continue;
    }
    // an image still uploading has no path yet and is not part of the comment
    if (node.type === COMMENT_IMAGE_NODE && node.attrs?.path) {
      const width = node.attrs.width;
      blocks.push({
        type: CommentNodeType.Img,
        path: node.attrs.path,
        ...(typeof width === 'number' ? { width } : {}),
      });
    }
  }

  // the empty line the editor keeps under an image, or one the author left, is not content
  let start = 0;
  let end = blocks.length;
  while (start < end && isBlankParagraph(blocks[start])) start++;
  while (end > start && isBlankParagraph(blocks[end - 1])) end--;
  return blocks.slice(start, end);
};

const inlineToEditor = (child: IParagraphChild): JSONContent[] => {
  switch (child?.type) {
    case CommentNodeType.Text: {
      const nodes: JSONContent[] = [];
      child.value.split('\n').forEach((line, index) => {
        if (index > 0) nodes.push({ type: 'hardBreak' });
        if (line) nodes.push({ type: 'text', text: line });
      });
      return nodes;
    }
    case CommentNodeType.Mention:
      return [
        {
          type: COMMENT_MENTION_NODE,
          attrs: { id: child.value, name: child.name ?? null, avatar: child.avatar ?? null },
        },
      ];
    case CommentNodeType.Link:
      return [
        {
          type: 'text',
          text: child.title || child.url,
          marks: [{ type: LINK_MARK, attrs: { href: child.url } }],
        },
      ];
    default:
      return [];
  }
};

export const commentToEditorDoc = (content: ICommentContent): JSONContent => {
  const blocks = content.map((block): JSONContent => {
    if (block.type === CommentNodeType.Img) {
      return {
        type: COMMENT_IMAGE_NODE,
        attrs: { path: block.path, url: block.url ?? null, width: block.width ?? null },
      };
    }
    const inline = (block.children ?? []).flatMap(inlineToEditor);
    return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' };
  });
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
};
