import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Bell } from '@teable/icons';
import {
  getCommentSubscribe,
  createCommentSubscribe,
  deleteCommentSubscribe,
} from '@teable/openapi';
import { Toggle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
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

  return (
    <TooltipProvider>
      <Tooltip>
        <div className="flex h-10 items-center justify-between border-b p-1 px-3">
          <div>{t('comment.title')}</div>
          <TooltipTrigger>
            <Toggle
              aria-label="Toggle italic"
              size={'sm'}
              variant={'default'}
              pressed={!!subscribeStatus}
              onPressedChange={() => subscribeHandler()}
            >
              <Bell />
            </Toggle>
          </TooltipTrigger>
        </div>
        <TooltipContent>
          <p>{subscribeStatus ? t('comment.tip.onNotify') : t('comment.tip.offNotify')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
