import type { IColumnMeta } from '@teable/core';
import { ViewType } from '@teable/core';

export const getFieldHiddenFilter = (viewType: ViewType, columnMeta: IColumnMeta) => {
  const isHiddenByVisible = (fieldId: string) =>
    Boolean((columnMeta[fieldId] as { visible?: boolean }).visible);
  const isHiddenByHidden = (fieldId: string) =>
    !(columnMeta[fieldId] as { hidden?: boolean }).hidden;

  return [ViewType.Form, ViewType.Kanban].includes(viewType) ? isHiddenByVisible : isHiddenByHidden;
};
