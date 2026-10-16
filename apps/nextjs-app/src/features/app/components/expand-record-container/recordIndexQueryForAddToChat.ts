import type { IRecordIndexRo } from '@teable/openapi';

export type IAddToChatActiveView = {
  tableId?: string;
  viewId?: string;
  query?: Omit<IRecordIndexRo, 'recordId'>;
};

export type IAddToChatIndexArgs = {
  tableId: string;
  recordId: string;
  viewId?: string;
  search?: IRecordIndexRo['search'];
};

/**
 * Linked records open without a view id on purpose. Only an actual matching
 * view may reuse the active view's filter, order, and collapsed groups.
 */
export const recordIndexQueryForAddToChat = (
  args: IAddToChatIndexArgs,
  active: IAddToChatActiveView | undefined
): IRecordIndexRo => {
  const sameView =
    Boolean(args.viewId) && active?.tableId === args.tableId && active.viewId === args.viewId;
  if (sameView && active?.query) {
    return {
      ...active.query,
      recordId: args.recordId,
      viewId: args.viewId,
      search: args.search ?? active.query.search,
    };
  }
  return {
    recordId: args.recordId,
    viewId: args.viewId,
    search: args.search,
  };
};

/**
 * A record opened with ignoreViewQuery can sit outside the filtered view.
 * Retry without that filter, still naming the same record, and never borrow
 * another view's filter.
 */
export const recordIndexFallbackQuery = (query: IRecordIndexRo): IRecordIndexRo | undefined => {
  if (query.ignoreViewQuery) return undefined;
  return {
    recordId: query.recordId,
    ignoreViewQuery: true,
    search: query.search,
  };
};
