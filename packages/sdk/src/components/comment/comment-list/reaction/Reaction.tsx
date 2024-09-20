import { useMutation } from '@tanstack/react-query';
import type { ICommentVo, IUpdateCommentReactionRo } from '@teable/openapi';
import { deleteCommentReaction, createCommentReaction } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib';

import { useSession, useTableId } from '../../../../hooks';
import { useRecordId } from '../../hooks';
interface ICommentReactionProps {
  commentId: string;
  value: ICommentVo['reaction'];
}

export const Reaction = (props: ICommentReactionProps) => {
  const { value, commentId } = props;
  const tableId = useTableId();
  const recordId = useRecordId();
  const { user: sessionUser } = useSession();
  const { mutateAsync: createCommentReactionFn } = useMutation({
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
  const { mutateAsync: deleteCommentEmojiFn } = useMutation({
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
    }) => deleteCommentReaction(tableId, recordId, commentId, reactionRo),
  });

  const reactionHandler = async (emoji: string) => {
    const users = value?.find((item) => item.reaction === emoji)?.user || [];
    if (!tableId || !recordId) {
      return;
    }
    if (users.includes(sessionUser?.id)) {
      await deleteCommentEmojiFn({ tableId, recordId, commentId, reactionRo: { reaction: emoji } });
    } else {
      await createCommentReactionFn({
        tableId,
        recordId,
        commentId,
        reactionRo: { reaction: emoji },
      });
    }
  };

  return (
    value && (
      <div className="mt-1 flex max-h-24 w-full flex-wrap gap-1 overflow-auto">
        {value?.map(({ reaction, user }, index) => (
          <Button
            variant={'outline'}
            key={index}
            size={'xs'}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-full border px-1.5 py-0.5 text-xs min-w-12 max-w-16',
              {
                'bg-blue-100/20 border-blue-200': user.includes(sessionUser.id),
              }
            )}
            onClick={(e) => {
              e.stopPropagation();
              reactionHandler(reaction);
            }}
          >
            <span className={cn('text-xs shrink-0')}>{reaction}</span>
            <span className="truncate text-secondary-foreground">
              {user.length < 99 ? user.length : '99+'}
            </span>
          </Button>
        ))}
      </div>
    )
  );
};
