import type { IBaseQuery, IBaseQueryColumn } from '@teable/openapi';
import { noop } from 'lodash';
import React from 'react';

export type QueryEditorKey = Exclude<keyof IBaseQuery, 'from'>;

export type IContextColumns = (IBaseQueryColumn & { groupTableId?: string })[];

export interface IQueryEditorContext {
  columns: {
    from: IContextColumns;
    join: IContextColumns;
  };
  canSelectedColumnIds?: string[];
  status: Record<QueryEditorKey, boolean>;
  setStatus: (key: QueryEditorKey, value: boolean) => void;
}

export const QueryEditorContext = React.createContext<IQueryEditorContext>({
  columns: {
    from: [],
    join: [],
  },
  status: {
    select: false,
    aggregation: false,
    where: false,
    orderBy: false,
    groupBy: false,
    limit: false,
    offset: false,
    join: false,
  },
  setStatus: noop,
});
