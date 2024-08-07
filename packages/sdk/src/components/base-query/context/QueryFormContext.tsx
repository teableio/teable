import { noop } from 'lodash';
import { createContext } from 'react';
import type { QuerySortedKeys } from '../constant';

export type IQueryValidatorKey = (typeof QuerySortedKeys)[number];

export interface IQueryFormContext {
  validators: Record<IQueryValidatorKey, (() => boolean) | undefined>;
  registerValidator: (key: IQueryValidatorKey, fn?: () => boolean) => void;
}

export const QueryFormContext = createContext<IQueryFormContext>({
  validators: {
    join: undefined,
    select: undefined,
    groupBy: undefined,
    orderBy: undefined,
    where: undefined,
    limit: undefined,
    offset: undefined,
    aggregation: undefined,
  },
  registerValidator: noop,
});
