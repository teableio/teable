import { useQuery } from '@tanstack/react-query';
import { assertNever } from '@teable/core';
import { X } from '@teable/icons';
import type { ICommentContent } from '@teable/openapi';
import { getCommentDetail, CommentNodeType } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';
import { useMemo } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useTableId } from '../../../hooks';
import { MentionUser, BlockImageElement } from '../comment-list/node';
import { useRecordId } from '../hooks';

interface ICommentQuoteProps {
  quoteId?: string;
  className?: string;
  onClose?: () => void;
}

export const CommentQuote = (props: ICommentQuoteProps) => {
  const { className, quoteId, onClose } = props;
  const tableId = useTableId();
  const recordId = useRecordId();
  const { t } = useTranslation();
  const { data: quoteData } = useQuery({
    queryKey: ReactQueryKeys.commentDetail(tableId!, recordId!, quoteId!),
    queryFn: () => getCommentDetail(tableId!, recordId!, quoteId!).then((res) => res.data),
    enabled: !!tableId && !!recordId && !!quoteId,
  });

  const findDisplayLine = (commentContent: ICommentContent) => {
    for (let i = 0; i < commentContent.length; i++) {
      const curLine = commentContent[i];
      if (curLine.type === CommentNodeType.Paragraph && curLine?.children?.length) {
        return curLine.children;
      }

      if (curLine.type === CommentNodeType.Img) {
        return curLine;
      }
    }

    return null;
  };

  const quoteAbbreviationRender = useMemo(() => {
    const displayLine = findDisplayLine(quoteData?.content || []);

    if (!quoteData || !displayLine) {
      return null;
    }

    // only display the first line of the quote
    if (Array.isArray(displayLine)) {
      return (
        <span className="truncate leading-6 text-secondary-foreground/50">
          {displayLine.map((node, index) => {
            switch (node.type) {
              case CommentNodeType.Link: {
                const title = node.title || node.url;
                return (
                  <span key={index} title={title}>
                    {title}
                  </span>
                );
              }
              case CommentNodeType.Text:
                return (
                  <span key={index} title={node.value}>
                    {node.value}
                  </span>
                );
              case CommentNodeType.Mention:
                return <MentionUser key={index} id={node.value} />;
              default:
                assertNever(node);
            }
          })}
        </span>
      );
    }

    if (displayLine.type === CommentNodeType.Img) {
      return <BlockImageElement path={displayLine.path} width={20} />;
    }

    return null;
  }, [quoteData]);

  return (
    quoteId && (
      <div
        className={cn(
          'flex items-center justify-between truncate bg-secondary px-2 py-1 h-8 overflow-hidden',
          className
        )}
      >
        <div className="flex h-full items-center truncate text-xs">
          <MentionUser id={quoteData ? quoteData.createdBy : ''} />
          <span className="self-center pr-1">:</span>
          {!quoteData ? (
            <del className="self-center text-secondary-foreground/50">
              {t('comment.deletedComment')}
            </del>
          ) : (
            quoteAbbreviationRender
          )}
        </div>
        {onClose && (
          <Button variant={'ghost'} size={'xs'}>
            <X onClick={() => onClose?.()} />
          </Button>
        )}
      </div>
    )
  );
};
