import type { IColumnMeta, IKanbanViewOptions, IViewVo } from '@teable/core';
import { FieldType, ViewType } from '@teable/core';
import type { IFieldInstance } from '../features/field/model/factory';

export const getFieldHiddenFilter = (viewType: ViewType, columnMeta: IColumnMeta) => {
  const isHiddenByVisible = (fieldId: string) =>
    Boolean((columnMeta[fieldId] as { visible?: boolean }).visible);
  const isHiddenByHidden = (fieldId: string) =>
    !(columnMeta[fieldId] as { hidden?: boolean }).hidden;

  return [ViewType.Form, ViewType.Kanban].includes(viewType) ? isHiddenByVisible : isHiddenByHidden;
};

export const checkIsNecessaryField = (field: IFieldInstance, view: IViewVo) => {
  const { id: fieldId, type: fieldType, isMultipleCellValue, isPrimary } = field;
  const { type: viewType, options } = view;

  if (isPrimary) return true;

  if (viewType === ViewType.Kanban) {
    const { stackFieldId, coverFieldId } = (options ?? {}) as IKanbanViewOptions;
    const isValidStackField =
      fieldId === stackFieldId &&
      [FieldType.SingleSelect, FieldType.User].includes(fieldType) &&
      !isMultipleCellValue;
    const isValidCoverField = fieldId === coverFieldId && fieldType === FieldType.Attachment;
    return isValidStackField || isValidCoverField;
  }
  return false;
};
