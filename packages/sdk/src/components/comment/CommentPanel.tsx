import { useEffect } from 'react';
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
  const { baseId, recordId, tableId, commentId } = props;
  const { resetCommentStore } = useCommentStore();

  useEffect(() => {
    return () => {
      resetCommentStore?.();
    };
  }, [resetCommentStore]);

  return (
    <CommentContext.Provider value={{ baseId, recordId }}>
      <div className="flex size-full flex-col border-l bg-background">
        <CommentHeader tableId={tableId} recordId={recordId} />
        <CommentList tableId={tableId} recordId={recordId} commentId={commentId} />
        <CommentEditor tableId={tableId} recordId={recordId} />
      </div>
    </CommentContext.Provider>
  );
};
