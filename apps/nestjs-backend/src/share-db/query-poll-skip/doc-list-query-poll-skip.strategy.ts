import type { IOtOperation } from '@teable/core';
import type { IQueryPollSkipStrategy } from '../interface';
import { recordQueryPollDecision } from '../metrics/query-poll-skip-metrics';

/**
 * Table and View query subscriptions resolve to a plain id list ordered by
 * the doc's top-level `order` (TableService / ViewService getDocIdsByQuery).
 * Membership only changes through create/del ops, which the entry guard in
 * index.ts already polls for, so the only edit op that can change the result
 * is one touching `order`. Every other edit — options, filter, sort, group,
 * columnMeta, isLocked, name, description, share*, lastModified*, and the
 * nested `views[]` mirror on the table doc — leaves the id list untouched.
 */
export class DocListQueryPollSkipStrategy implements IQueryPollSkipStrategy {
  shouldSkip(_collection: string, _id: string, ops: IOtOperation[]): boolean {
    for (const subOp of ops) {
      const key = subOp.p?.[0];
      // a sub op without an analyzable path must conservatively poll
      if (typeof key !== 'string') return recordQueryPollDecision(false, 'unanalyzable_op');
      if (key === 'order') return recordQueryPollDecision(false, 'order_relevant');
    }
    return recordQueryPollDecision(true, 'order_irrelevant');
  }
}
