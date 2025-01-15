import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart, MessageSquare, Edit, Trash2 } from '@teable/icons';
import type { ICommentVo, IUpdateCommentReactionRo } from '@teable/openapi';
import { deleteComment, createCommentReaction } from '@teable/openapi';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Button,
  cn,
  HoverCardPortal,
} from '@teable/ui-lib';
import { useState, useRef, useEffect } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useLanDayjs, useSession } from '../../../hooks';
import { UserAvatar } from '../../cell-value';
import { useModalRefElement } from '../../expand-record/useModalRefElement';
import { CommentQuote } from '../comment-editor/CommentQuote';
import type { IBaseQueryParams } from '../types';
import { useCommentStore } from '../useCommentStore';
import { CommentContent } from './CommentContent';
import { CommentListContext } from './context';
import { Reaction, ReactionPicker } from './reaction';

interface ICommentItemProps extends ICommentVo, IBaseQueryParams {
  commentId?: string;
}

export const CommentItem = (props: ICommentItemProps) => {
  const {
    createdBy,
    createdTime,
    content,
    id,
    recordId,
    tableId,
    quoteId,
    lastModifiedTime,
    reaction,
    commentId,
  } = props;
  const dayjs = useLanDayjs();
  const { t } = useTranslation();
  const [emojiPickOpen, setEmojiPickOpen] = useState(false);
  const relativeTime = dayjs(createdTime).fromNow();
  const { setQuoteId, setEditingCommentId, editorRef } = useCommentStore();
  const { user } = useSession();
  const isMe = user?.id === createdBy?.id;
  const queryClient = useQueryClient();
  const { mutateAsync: deleteCommentFn } = useMutation({
    mutationFn: ({ tableId, recordId, id }: { tableId: string; recordId: string; id: string }) =>
      deleteComment(tableId, recordId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.commentDetail(tableId, recordId, id),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.recordCommentCount(tableId, recordId),
      });
    },
  });
  const modalRef = useModalRefElement();
  const itemRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<boolean>(true);
  useEffect(() => {
    if (commentId && itemRef && commentId === id && firstRef.current) {
      setTimeout(() => {
        itemRef?.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
        firstRef.current = false;
      }, 200);
    }
  }, [commentId, id]);
  const { mutateAsync: createCommentEmojiFn } = useMutation({
    mutationFn: ({
      tableId,
      recordId,
      commentId,
      reactionRo,
    }: {
      tableId: string;
      recordId: string;
      commentId: string;
      reactionRo: IUpdateCommentReactionRo;
    }) => createCommentReaction(tableId, recordId, commentId, reactionRo),
  });
  return (
    createdBy && (
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <div
            className={cn('flex w-full gap-1 rounded-sm p-1 hover:bg-secondary', {
              'flex-row-reverse': isMe,
            })}
            ref={itemRef}
          >
            <div>
              <UserAvatar name={createdBy.name} avatar={createdBy.avatar} />
            </div>

            <div className="flex-1 truncate px-1">
              <div
                className={cn('flex flex-1 truncate text-xs gap-1 items-center', {
                  'flex-row-reverse': isMe,
                })}
              >
                <span
                  className={cn('truncate', {
                    'text-end': isMe,
                  })}
                >
                  {createdBy.name}
                </span>
                <span className="shrink-0 text-xs text-secondary-foreground/60">
                  {relativeTime}
                </span>
                {lastModifiedTime && (
                  <span className="shrink-0 text-xs text-secondary-foreground/50">
                    {t('comment.tip.edited')}
                  </span>
                )}
              </div>
              <div className={cn('pt-1 flex flex-col')}>
                <CommentListContext.Provider
                  value={{
                    isMe: isMe,
                  }}
                >
                  <CommentContent content={content} />
                  <CommentQuote
                    quoteId={quoteId}
                    className={cn(
                      'flex w-auto max-w-full self-start truncate rounded-md bg-secondary p-1 text-xs text-secondary-foreground/50 mt-0.5',
                      {
                        'self-end': isMe,
                      }
                    )}
                  />
                </CommentListContext.Provider>
              </div>
              <Reaction value={reaction} commentId={id} />
            </div>
          </div>
        </HoverCardTrigger>
        <HoverCardPortal container={modalRef.current}>
          <HoverCardContent
            side="top"
            className="size-auto p-1"
            sideOffset={-10}
            hideWhenDetached
            sticky="always"
          >
            <HoverCard
              open={emojiPickOpen}
              onOpenChange={(open) => {
                setEmojiPickOpen(open);
              }}
            >
              <HoverCardTrigger asChild>
                <Button
                  variant={'ghost'}
                  size={'xs'}
                  onClick={() => {
                    setEmojiPickOpen(true);
                  }}
                >
                  <Heart />
                </Button>
              </HoverCardTrigger>

              <HoverCardPortal container={modalRef.current}>
                <HoverCardContent side="top" className="size-auto p-0.5" hideWhenDetached>
                  <ReactionPicker
                    onReactionClick={(emoji) => {
                      createCommentEmojiFn({
                        tableId,
                        recordId,
                        commentId: id,
                        reactionRo: { reaction: emoji },
                      }).then(() => {
                        setTimeout(() => {
                          itemRef?.current &&
                            itemRef?.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'nearest',
                            });
                        }, 200);
                      });
                    }}
                  />
                </HoverCardContent>
              </HoverCardPortal>
            </HoverCard>

            <Button
              variant={'ghost'}
              size={'xs'}
              onClick={() => {
                setQuoteId(id);
                editorRef.focus();
              }}
            >
              <MessageSquare />
            </Button>
            {isMe && (
              <Button
                variant={'ghost'}
                size={'xs'}
                onClick={() => {
                  setEditingCommentId(id);
                  editorRef.focus();
                }}
              >
                <Edit />
              </Button>
            )}
            {isMe && (
              <Button
                variant={'ghost'}
                size={'xs'}
                onClick={() => {
                  deleteCommentFn({ tableId, recordId, id });
                }}
              >
                <Trash2 />
              </Button>
            )}
          </HoverCardContent>
        </HoverCardPortal>
      </HoverCard>
    )
  );
};
