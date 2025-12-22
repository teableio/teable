import type { OffsetPagination } from '../domain/shared/pagination/OffsetPagination';
import type { Sort } from '../domain/shared/sort/Sort';

export interface IFindOptions<TSortKey> {
  sort?: Sort<TSortKey>;
  pagination?: OffsetPagination;
}
