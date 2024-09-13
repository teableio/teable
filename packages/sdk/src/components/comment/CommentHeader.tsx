import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Bell } from '@teable/icons';
import { getCommentNotify, createCommentNotify, deleteCommentNotify } from '@teable/openapi';
import { Toggle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@teable/ui-lib';
import { ReactQueryKeys } from '../../config';
import { useTranslation } from '../../context/app/i18n';
import type { IBaseQueryParams } from './types';

interface ICommentHeaderProps extends IBaseQueryParams {}

export const CommentHeader = (props: ICommentHeaderProps) => {
  const { tableId, recordId } = props;
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: notifyStatus } = useQuery({
    queryKey: ReactQueryKeys.commentNotifyStatus(tableId, recordId),
    queryFn: () =>
      getCommentNotify(tableId!, recordId!)
        .then((res) => {
          return res.data;
        })
        .catch(() => {
          return false;
        }),
    enabled: !!(tableId && recordId),
  });

  const { mutateAsync: createNotifyFn } = useMutation({
    mutationFn: ({ tableId, recordId }: { tableId: string; recordId: string }) =>
      createCommentNotify(tableId, recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.commentNotifyStatus(tableId, recordId),
      });
    },
  });

  const { mutateAsync: deleteNotifyFn } = useMutation({
    mutationFn: ({ tableId, recordId }: { tableId: string; recordId: string }) =>
      deleteCommentNotify(tableId, recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.commentNotifyStatus(tableId, recordId),
      });
    },
  });

  const notifyHandler = () => {
    if (!notifyStatus) {
      createNotifyFn({ tableId: tableId!, recordId: recordId! });
    } else {
      deleteNotifyFn({ tableId: tableId!, recordId: recordId! });
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
              pressed={!!notifyStatus}
              onPressedChange={() => notifyHandler()}
            >
              <Bell />
            </Toggle>
          </TooltipTrigger>
        </div>
        <TooltipContent>
          <p>{notifyStatus ? t('comment.tip.onNotify') : t('comment.tip.offNotify')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
