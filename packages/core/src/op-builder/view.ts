import type { IFilter, IOtOperation } from '../models';
import type { ISort } from '../models/view/interface';

enum ViewMetaKey {
  Name = 'name',
  Description = 'description',
  Sort = 'sort',
  Filter = 'filter',
  Options = 'options',
}

export class ViewOpBuilder {
  private static setViewMeta<T>(params: {
    id: string;
    key: ViewMetaKey;
    oldValue: T;
    newValue: T;
  }): IOtOperation {
    const { id, key, oldValue, newValue } = params;

    return {
      p: ['viewMap', id, key],
      oi: newValue,
      od: oldValue,
    };
  }

  static setViewName(params: { id: string; oldValue: string | null; newValue: string | null }) {
    return this.setViewMeta({ ...params, key: ViewMetaKey.Name });
  }

  static setViewDescription(params: {
    id: string;
    oldValue: string | null;
    newValue: string | null;
  }) {
    return this.setViewMeta({ ...params, key: ViewMetaKey.Description });
  }

  static setViewSort(params: { id: string; oldValue: ISort | null; newValue: ISort | null }) {
    return this.setViewMeta({ ...params, key: ViewMetaKey.Sort });
  }

  static setViewFilter(params: { id: string; oldValue: IFilter | null; newValue: IFilter | null }) {
    return this.setViewMeta({ ...params, key: ViewMetaKey.Filter });
  }

  static setViewOptions(params: {
    id: string;
    oldValue: Record<string, unknown> | null;
    newValue: Record<string, unknown> | null;
  }) {
    return this.setViewMeta({ ...params, key: ViewMetaKey.Options });
  }
}
