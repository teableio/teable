import type { InfiniteData } from '@tanstack/react-query';
import type { IGetCommentListVo } from '@teable/openapi';

export type ICommentListCache = InfiniteData<IGetCommentListVo>;

/**
 * The panel renders the union of the paged cache and the locally patched list,
 * so dropping a deleted comment from the local list alone does not stick: the
 * page still holds it and the merge puts it straight back on the next render.
 * The deleted comment then looks alive but no longer is, and deleting it again
 * answers `Comment not found`.
 */
export const removeCommentFromPages = (
  cache: ICommentListCache | undefined,
  commentId: string
): ICommentListCache | undefined => {
  if (!cache) {
    return cache;
  }
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      comments: page.comments.filter((comment) => comment.id !== commentId),
    })),
  };
};
