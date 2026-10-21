import { describe, expect, it } from 'vitest';
import type { ICommentListCache } from './commentListCache';
import { removeCommentFromPages } from './commentListCache';

const comment = (id: string) => ({ id }) as ICommentListCache['pages'][number]['comments'][number];

const cache = (pages: string[][]): ICommentListCache => ({
  pages: pages.map((ids) => ({ comments: ids.map(comment), nextCursor: null })),
  pageParams: pages.map(() => undefined),
});

describe('removeCommentFromPages', () => {
  it('drops the comment from the page holding it', () => {
    const result = removeCommentFromPages(cache([['c1', 'c2', 'c3']]), 'c2');

    expect(result?.pages[0].comments.map(({ id }) => id)).toEqual(['c1', 'c3']);
  });

  it('leaves the other pages alone', () => {
    const result = removeCommentFromPages(cache([['c1', 'c2'], ['c3']]), 'c2');

    expect(result?.pages.map((page) => page.comments.map(({ id }) => id))).toEqual([
      ['c1'],
      ['c3'],
    ]);
  });

  it('is a no-op for an id that is not cached', () => {
    const result = removeCommentFromPages(cache([['c1']]), 'gone');

    expect(result?.pages[0].comments.map(({ id }) => id)).toEqual(['c1']);
  });

  it('leaves an empty cache untouched so setQueryData skips the write', () => {
    expect(removeCommentFromPages(undefined, 'c1')).toBeUndefined();
  });
});
