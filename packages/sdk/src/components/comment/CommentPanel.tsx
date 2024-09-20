import { useQuery } from '@tanstack/react-query';
import { getBaseCollaboratorList } from '@teable/openapi';
import { useEffect } from 'react';
import { ReactQueryKeys } from '../../config';
import { CommentEditor } from './comment-editor';
import { CommentList } from './comment-list';
import { CommentHeader } from './CommentHeader';
import { CommentContext } from './context';
import type { IBaseQueryParams } from './types';
import { useCommentStore } from './useCommentStore';

interface ICommentPanelProps extends IBaseQueryParams {
  baseId: string;
  tableId: string;
  recordId: string;
  commentId?: string;
}

export const CommentPanel = (props: ICommentPanelProps) => {
  const { recordId, tableId, baseId, commentId } = props;
  const { resetCommentStore } = useCommentStore();

  const { data: collaborators = [] } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
    queryFn: ({ queryKey }) => getBaseCollaboratorList(queryKey[1]).then((res) => res.data),
  });

  useEffect(() => {
    return () => {
      resetCommentStore?.();
    };
  }, [resetCommentStore]);

  return (
    <CommentContext.Provider value={{ collaborators: collaborators, recordId }}>
      <div className="flex size-full flex-col border-l bg-background">
        <CommentHeader tableId={tableId} recordId={recordId} />
        <CommentList tableId={tableId} recordId={recordId} commentId={commentId} />
        <CommentEditor tableId={tableId} recordId={recordId} />
      </div>
    </CommentContext.Provider>
  );
};
