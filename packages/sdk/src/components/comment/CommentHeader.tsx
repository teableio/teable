import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown } from '@teable/icons';
import {
  getCommentSubscribe,
  createCommentSubscribe,
  deleteCommentSubscribe,
} from '@teable/openapi';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import type { IBaseQueryParams } from './types';

interface ICommentHeaderProps extends IBaseQueryParams {}

export const CommentHeader = (props: ICommentHeaderProps) => {
  const { tableId, recordId } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: subscribeStatus } = useQuery({
    queryKey: ReactQueryKeys.commentSubscribeStatus(tableId, recordId),
    queryFn: () =>
      getCommentSubscribe(tableId!, recordId!).then((res) => {
        return res.data;
      }),
    enabled: !!(tableId && recordId),
  });

  const { mutateAsync: createSubscribe } = useMutation({
    mutationFn: ({ tableId, recordId }: { tableId: string; recordId: string }) =>
      createCommentSubscribe(tableId, recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.commentSubscribeStatus(tableId, recordId),
      });
    },
  });

  const { mutateAsync: deleteSubscribeFn } = useMutation({
    mutationFn: ({ tableId, recordId }: { tableId: string; recordId: string }) =>
      deleteCommentSubscribe(tableId, recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.commentSubscribeStatus(tableId, recordId),
      });
    },
  });

  const subscribeHandler = () => {
    if (!subscribeStatus) {
      createSubscribe({ tableId: tableId!, recordId: recordId! });
    } else {
      deleteSubscribeFn({ tableId: tableId!, recordId: recordId! });
    }
  };

  const subscribeComment = () => {
    if (!subscribeStatus) {
      createSubscribe({ tableId: tableId!, recordId: recordId! });
    }
  };

  const unsubscribeComment = () => {
    if (subscribeStatus) {
      deleteSubscribeFn({ tableId: tableId!, recordId: recordId! });
    }
  };

  return (
    <div className="flex h-[52px] items-center justify-between border-b p-1 px-3">
      <div>{t('comment.title')}</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={'xs'} className="gap-2 p-2">
            <Bell className="size-4" />
            <span className="text-sm">
              {subscribeStatus ? t('comment.tip.all') : t('comment.tip.relatedToMe')}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem className="text-sm" onSelect={() => subscribeComment()}>
            {t('comment.tip.notifyAll')}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-sm" onSelect={() => unsubscribeComment()}>
            {t('comment.tip.notifyRelatedToMe')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
