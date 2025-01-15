import { CommentNodeType } from '@teable/openapi';
import type { ICommentContent } from '@teable/openapi';
import { cn } from '@teable/ui-lib';
import { MentionUser, BlockImageElement, InlineLinkElement, BlockParagraphElement } from './node';
import { useIsMe } from './useIsMe';

interface ICommentContentProps {
  content: ICommentContent;
  className?: string;
  isExpanded?: boolean;
}

export const CommentContent = (props: ICommentContentProps) => {
  const { content, className, isExpanded = false } = props;
  const isMe = useIsMe();
  const finalContent = content.map((item: ICommentContent[number], index) => {
    if (item.type === CommentNodeType.Img) {
      return (
        <BlockImageElement
          key={index}
          path={item.path}
          url={item.url}
          width={item.width}
          className={cn({
            'justify-end': isMe && !isExpanded,
          })}
        />
      );
    } else {
      return (
        <BlockParagraphElement
          key={index}
          className={cn('my-0.5', {
            'justify-end': isMe && !isExpanded,
          })}
        >
          {item.children.map((node, index) => {
            switch (node.type) {
              case CommentNodeType.Text: {
                return <span key={index}>{node.value}</span>;
              }
              case CommentNodeType.Mention: {
                return (
                  <MentionUser
                    id={node.value}
                    key={node.value}
                    name={node.name}
                    avatar={node.avatar}
                    className="mx-0.5 cursor-pointer rounded-md bg-secondary px-1 focus:ring-2"
                  />
                );
              }
              case CommentNodeType.Link: {
                return <InlineLinkElement href={node.url} key={index} title={node.title} />;
              }
            }
          })}
        </BlockParagraphElement>
      );
    }
  });
  return <div className={cn('text-sm', className)}>{finalContent}</div>;
};
