import { useQuery } from '@tanstack/react-query';
import { assertNever } from '@teable/core';
import { X, ChevronRight } from '@teable/icons';
import type { ICommentContent } from '@teable/openapi';
import { getCommentDetail, CommentNodeType } from '@teable/openapi';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useTableId } from '../../../hooks';
import { CommentContent } from '../comment-list/CommentContent';
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
  const textRef = useRef<HTMLElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const checkTextOverflow = () => {
      const element = textRef.current;
      if (element) {
        setShowTooltip(element.scrollWidth > element.clientWidth);
      }
    };

    checkTextOverflow();
    window.addEventListener('resize', checkTextOverflow);

    return () => {
      window.removeEventListener('resize', checkTextOverflow);
    };
  }, [quoteData]);

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
        <span className="truncate leading-6 text-secondary-foreground/50" ref={textRef}>
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
                return (
                  <MentionUser key={index} id={node.value} name={node.name} avatar={node.avatar} />
                );
              default:
                assertNever(node);
            }
          })}
        </span>
      );
    }

    if (displayLine.type === CommentNodeType.Img) {
      return <BlockImageElement path={displayLine.path} width={20} url={displayLine.url} />;
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
          {quoteData?.createdBy && <MentionUser {...quoteData.createdBy} />}
          <span className="self-center pr-1">:</span>
          {!quoteData ? (
            <del className="self-center text-secondary-foreground/50">
              {t('comment.deletedComment')}
            </del>
          ) : (
            <>
              {quoteAbbreviationRender}
              {showTooltip && (
                <Popover modal={true}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size={'xs'} className={cn('p-0')}>
                      <ChevronRight />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="max-h-40 max-w-60 overflow-auto p-2">
                    <CommentContent content={quoteData.content} isExpanded />
                  </PopoverContent>
                </Popover>
              )}
            </>
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
