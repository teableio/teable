import { FieldKeyType, type IFieldVo, type IGetFieldsQuery, type IViewVo } from '@teable/core';
import { sortBy } from 'lodash';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';

export async function filterFieldsByQuery(
  fields: IFieldVo[],
  query?: IGetFieldsQuery & {
    view?: Pick<IViewVo, 'type' | 'options' | 'columnMeta'>;
  }
): Promise<IFieldVo[]> {
  // filter by projection
  if (query?.projection) {
    return filterFieldsByProjection(fields, query.projection);
  }

  /**
   * filter by query
   * filterHidden depends on viewId so only judge viewId
   */
  const { view, viewId, filterHidden } = query ?? {};

  if (viewId && view) {
    return filterFieldsByView(fields, view, { filterHidden, sortByOrder: true });
  }

  return fields;
}

export const filterFieldsByProjection = (
  fields: IFieldVo[],
  projection?: string[],
  fieldKeyType: FieldKeyType = FieldKeyType.Id
) => {
  if (!projection) {
    return fields;
  }
  return fields.filter((field) => projection.includes(field[fieldKeyType]));
};

export const filterFieldsByView = (
  fields: IFieldVo[],
  view?: Pick<IViewVo, 'type' | 'options' | 'columnMeta'>,
  opts?: {
    filterHidden?: boolean;
    sortByOrder?: boolean;
  }
) => {
  if (!view) {
    return fields;
  }
  const { filterHidden, sortByOrder } = opts ?? {};
  let result = fields;
  if (filterHidden) {
    result = result.filter((field) => isNotHiddenField(field.id, view));
  }
  if (sortByOrder) {
    result = sortBy(result, (field) => {
      return view?.columnMeta[field.id].order;
    });
  }
  return result;
};
