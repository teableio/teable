import { CommentNodeType } from '@teable/openapi';
import type { ICommentContent } from '@teable/openapi';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommentImage } from './extensions/image';
import { CommentMention } from './extensions/mention';
import {
  COMMENT_IMAGE_NODE,
  COMMENT_MENTION_NODE,
  commentToEditorDoc,
  editorDocToComment,
} from './transform';

const schema = getSchema([
  StarterKit.configure({ heading: false, bold: false, italic: false }),
  CommentImage,
  CommentMention,
]);

// through the editor schema, so a shape the editor would reject fails here too
const roundTrip = (content: ICommentContent) => {
  const node = schema.nodeFromJSON(commentToEditorDoc(content));
  node.check();
  return editorDocToComment(node.toJSON());
};

describe('comment editor transform', () => {
  it('round-trips text, mentions, links and line breaks', () => {
    const content: ICommentContent = [
      {
        type: CommentNodeType.Paragraph,
        children: [
          { type: CommentNodeType.Text, value: 'hi ' },
          { type: CommentNodeType.Mention, value: 'usr1' },
          { type: CommentNodeType.Text, value: ' see\nthis ' },
          { type: CommentNodeType.Link, url: 'https://teable.ai', title: 'Teable' },
        ],
      },
      { type: CommentNodeType.Img, path: 'comment/abc', width: 240 },
      {
        type: CommentNodeType.Paragraph,
        children: [{ type: CommentNodeType.Text, value: 'after' }],
      },
    ];

    expect(roundTrip(content)).toEqual(content);
  });

  it('keeps blank lines between paragraphs but trims them at both ends', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '  ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        { type: COMMENT_IMAGE_NODE, attrs: { path: 'p1', url: 'blob:x', width: null } },
        { type: 'paragraph' },
      ],
    };

    expect(editorDocToComment(doc)).toEqual([
      { type: CommentNodeType.Paragraph, children: [{ type: CommentNodeType.Text, value: 'a' }] },
      { type: CommentNodeType.Paragraph, children: [{ type: CommentNodeType.Text, value: '  ' }] },
      { type: CommentNodeType.Paragraph, children: [{ type: CommentNodeType.Text, value: 'b' }] },
      { type: CommentNodeType.Img, path: 'p1' },
    ]);
  });

  it('treats an empty or whitespace-only editor as no comment', () => {
    expect(editorDocToComment({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
    expect(
      editorDocToComment({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: ' ' }, { type: 'hardBreak' }] },
        ],
      })
    ).toEqual([]);
  });

  it('leaves out an image whose upload has not finished', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'look' }] },
        { type: COMMENT_IMAGE_NODE, attrs: { path: null, url: null, uploadId: 'up1' } },
      ],
    };

    expect(editorDocToComment(doc)).toEqual([
      {
        type: CommentNodeType.Paragraph,
        children: [{ type: CommentNodeType.Text, value: 'look' }],
      },
    ]);
  });

  it('only stores the id of a mention and drops ones without an id', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: COMMENT_MENTION_NODE, attrs: { id: 'usr1', name: 'Ann', avatar: 'a.png' } },
            { type: COMMENT_MENTION_NODE, attrs: { id: null, name: 'Ghost' } },
          ],
        },
      ],
    };

    expect(editorDocToComment(doc)).toEqual([
      {
        type: CommentNodeType.Paragraph,
        children: [{ type: CommentNodeType.Mention, value: 'usr1' }],
      },
    ]);
  });

  it('merges a link split across text nodes into one link', () => {
    const link = [{ type: 'link', attrs: { href: 'https://a.io' } }];
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'go ', marks: [] },
            { type: 'text', text: 'here', marks: link },
            { type: 'text', text: ' now', marks: link },
          ],
        },
      ],
    };

    expect(editorDocToComment(doc)).toEqual([
      {
        type: CommentNodeType.Paragraph,
        children: [
          { type: CommentNodeType.Text, value: 'go ' },
          { type: CommentNodeType.Link, url: 'https://a.io', title: 'here now' },
        ],
      },
    ]);
  });

  it('shows the url of a link saved without a title, and an empty comment as one empty line', () => {
    expect(
      commentToEditorDoc([
        {
          type: CommentNodeType.Paragraph,
          children: [{ type: CommentNodeType.Link, url: 'https://a.io', title: '' }],
        },
      ])
    ).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'https://a.io',
              marks: [{ type: 'link', attrs: { href: 'https://a.io' } }],
            },
          ],
        },
      ],
    });
    expect(commentToEditorDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('carries the display name and avatar of a mention into the editor', () => {
    const doc = commentToEditorDoc([
      {
        type: CommentNodeType.Paragraph,
        children: [{ type: CommentNodeType.Mention, value: 'usr1', name: 'Ann', avatar: 'a.png' }],
      },
    ]);

    expect(doc.content?.[0].content?.[0]).toEqual({
      type: COMMENT_MENTION_NODE,
      attrs: { id: 'usr1', name: 'Ann', avatar: 'a.png' },
    });
  });
});
