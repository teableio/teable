import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { getCommentList, CommentPatchType } from '@teable/openapi';
import type { ICommentVo, ICommentPatchData } from '@teable/openapi';
import { Spin, Button } from '@teable/ui-lib';
import { isEqual } from 'lodash';
import { forwardRef, useImperativeHandle, useRef, useEffect, useCallback, useState } from 'react';
import { ReactQueryKeys } from '../../../config';
import { useTranslation } from '../../../context/app/i18n';
import { useSession } from '../../../hooks';
import type { IBaseQueryParams } from '../types';
import { CommentItem } from './CommentItem';
import { CommentSkeleton } from './CommentSkeleton';
import { useCommentPatchListener } from './useCommentPatchListener';

export interface ICommentListProps extends IBaseQueryParams {
  commentId?: string;
}

export interface CommentListRefHandle {
  scrollToBottom: () => void;
}

export const CommentList = forwardRef<CommentListRefHandle, ICommentListProps>((props, ref) => {
  const { tableId, recordId, commentId } = props;
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [commentList, setCommentList] = useState<ICommentVo[]>([]);
  const { user: self } = useSession();

  useEffect(() => {
    // reset comment list when switch record
    setCommentList([]);
  }, [tableId, recordId]);

  const queryClient = useQueryClient();
  useEffect(() => {
    return () => queryClient.removeQueries(ReactQueryKeys.commentList(tableId, recordId));
  }, [queryClient, recordId, tableId]);

  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      const scrollHeight = listRef.current.scrollHeight;
      listRef.current.scrollTo({
        top: scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  const scrollDownSlightly = useCallback(() => {
    if (listRef.current) {
      const scrollTop = listRef.current.scrollTop;
      listRef.current.scrollTo({
        top: scrollTop + 48,
        behavior: 'smooth',
      });
    }
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToBottom: scrollToBottom,
  }));

  const { data, fetchPreviousPage, isFetchingPreviousPage, hasPreviousPage, isLoading } =
    useInfiniteQuery({
      queryKey: ReactQueryKeys.commentList(tableId, recordId),
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
      queryFn: ({ pageParam }) =>
        getCommentList(tableId!, recordId!, {
          cursor: pageParam?.cursor,
          take: 20,
          direction: pageParam?.direction || 'forward',
        }).then((res) => res.data),
      getPreviousPageParam: (firstPage) =>
        firstPage.nextCursor
          ? {
              cursor: firstPage.nextCursor,
              direction: 'forward',
            }
          : undefined,
      onSuccess: (data) => {
        // first come move to bottom
        if (data.pages.length === 1 && listRef.current) {
          const scrollToBottom = () => {
            if (listRef.current) {
              const scrollHeight = listRef.current.scrollHeight;
              listRef.current.scrollTop = scrollHeight;
            }
          };
          setTimeout(scrollToBottom, 100);
        }
      },
      enabled: !!tableId && !!recordId,
    });

  useEffect(() => {
    let result = [...commentList];
    const pageList = data?.pages.flatMap((page) => page.comments);
    if (Array.isArray(pageList)) {
      const uniqueComments: Record<string, ICommentVo> = {};

      [...pageList, ...result].forEach((comment) => {
        uniqueComments[comment.id] = comment;
      });

      const mergedList = Object.values(uniqueComments) as ICommentVo[];

      result = mergedList;
    }

    result = result.sort(
      (a, b) => new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime()
    );

    if (!isEqual(result, commentList)) {
      setCommentList(result);
    }
  }, [commentList, data?.pages]);

  const commentListener = useCallback(
    (remoteData: unknown) => {
      const { data, type } = remoteData as ICommentPatchData;

      switch (type) {
        case CommentPatchType.CreateComment: {
          setCommentList((prevList) => [
            ...prevList,
            {
              ...data,
            } as ICommentVo,
          ]);
          if (data.createdBy === self.id) {
            setTimeout(() => {
              scrollToBottom();
            }, 100);
          } else {
            setTimeout(() => {
              scrollDownSlightly();
            }, 100);
          }
          break;
        }
        case CommentPatchType.DeleteComment: {
          setCommentList((prevList) => prevList.filter((comment) => comment.id !== data.id));
          break;
        }

        case CommentPatchType.UpdateComment:
        case CommentPatchType.CreateReaction:
        case CommentPatchType.DeleteReaction: {
          setCommentList((prevList) => {
            const newList = [...prevList];
            const index = newList.findIndex((list) => list.id === data.id);
            if (index > -1) {
              newList[index] = { ...data } as ICommentVo;
            }
            return newList;
          });
          break;
        }
      }
    },
    [scrollDownSlightly, scrollToBottom, self.id]
  );

  useCommentPatchListener(tableId, recordId, commentListener);

  return (
    <div className="my-1 flex w-full flex-1 flex-col overflow-y-auto px-1" ref={listRef}>
      {isLoading ? (
        <CommentSkeleton />
      ) : (
        <>
          {isFetchingPreviousPage ? (
            <div className="flex h-6 w-full justify-center">
              <Spin />
            </div>
          ) : (
            hasPreviousPage && (
              <Button
                size="xs"
                variant={'ghost'}
                onClick={() => fetchPreviousPage()}
                className="p-1"
              >
                {t('common.loadMore')}
              </Button>
            )
          )}

          {commentList?.length ? (
            commentList.map((comment) => (
              <CommentItem
                key={comment.id}
                {...comment}
                tableId={tableId}
                recordId={recordId}
                commentId={commentId}
              />
            ))
          ) : (
            <div className="flex size-full items-center justify-center text-center text-gray-400">
              {t('comment.emptyComment')}
            </div>
          )}
        </>
      )}
    </div>
  );
});

CommentList.displayName = 'CommentList';
