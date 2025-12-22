import type { PageLimit } from './PageLimit';
import { PageOffset } from './PageOffset';

export class OffsetPagination {
  private constructor(
    private readonly limitValue: PageLimit,
    private readonly offsetValue: PageOffset
  ) {}

  static create(limit: PageLimit, offset: PageOffset = PageOffset.zero()): OffsetPagination {
    return new OffsetPagination(limit, offset);
  }

  limit(): PageLimit {
    return this.limitValue;
  }

  offset(): PageOffset {
    return this.offsetValue;
  }
}
