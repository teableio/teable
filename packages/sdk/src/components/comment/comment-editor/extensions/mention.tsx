import { cn } from '@teable/ui-lib';
import { mergeAttributes, Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';
import { Suggestion } from '@tiptap/suggestion';
import { MentionUser, mentionChipClassName } from '../../comment-list/node';
import { COMMENT_MENTION_NODE } from '../transform';

export interface IMentionItem {
  id: string;
  name: string;
  avatar?: string | null;
}

export const commentMentionPluginKey = new PluginKey('commentMention');

const CommentMentionView = (props: NodeViewProps) => {
  const { node, selected } = props;
  const { id, name, avatar } = node.attrs as IMentionItem;
  return (
    <NodeViewWrapper as="span">
      <MentionUser
        id={id}
        name={name}
        avatar={avatar ?? undefined}
        className={cn(mentionChipClassName, selected && 'ring-1 ring-inset ring-primary')}
      />
    </NodeViewWrapper>
  );
};

export interface ICommentMentionOptions {
  suggestion: Omit<SuggestionOptions<IMentionItem>, 'editor'>;
}

/** An @-mentioned collaborator: `id` is what the comment stores, the rest is display. */
export const CommentMention = Node.create<ICommentMentionOptions>({
  name: COMMENT_MENTION_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { suggestion: {} };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-id'),
        renderHTML: (attrs) => ({ 'data-id': attrs.id }),
      },
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-name'),
        renderHTML: (attrs) => (attrs.name ? { 'data-name': attrs.name } : {}),
      },
      avatar: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-avatar'),
        renderHTML: (attrs) => (attrs.avatar ? { 'data-avatar': attrs.avatar } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="comment-mention"][data-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'comment-mention' }),
      `@${node.attrs.name ?? ''}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.name ?? ''}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CommentMentionView, { as: 'span' });
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<IMentionItem>({
        pluginKey: commentMentionPluginKey,
        char: '@',
        // a mention starts a word: line start, whitespace, or an opening quote
        allowedPrefixes: [' ', ' ', '"', "'"],
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              {
                type: COMMENT_MENTION_NODE,
                attrs: { id: props.id, name: props.name, avatar: props.avatar ?? null },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        ...this.options.suggestion,
        editor: this.editor,
      }),
    ];
  },
});
