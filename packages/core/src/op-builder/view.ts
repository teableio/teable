import type { IOtOperation } from '../models';
import type { IFilter, ISort, IView } from '../models/view/interface';

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

  static addView(params: { view: IView; index: number }): IOtOperation[] {
    const { view, index } = params;

    const ops: IOtOperation[] = [];

    ops.push({
      p: ['viewList', index],
      li: { viewId: view.id },
    });

    ops.push({
      p: ['viewMap', view.id],
      oi: view,
    });

    return ops;
  }

  static deleteView(params: { oldView: IView; index: number }): IOtOperation[] {
    const { oldView, index } = params;

    const ops: IOtOperation[] = [];

    ops.push({
      p: ['viewList', index],
      ld: { viewId: oldView.id },
    });

    ops.push({
      p: ['viewMap', oldView.id],
      od: oldView,
    });

    return ops;
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
