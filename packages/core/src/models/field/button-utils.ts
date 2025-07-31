import type { IButtonFieldCellValue, IButtonFieldOptions } from './derivate';

export const checkButtonClickable = (
  fieldOptions: IButtonFieldOptions,
  cellValue?: IButtonFieldCellValue
) => {
  const workflow = fieldOptions.workflow;
  if (!workflow) {
    return false;
  }
  const { id: workflowId, isActive = false } = workflow;
  if (!workflowId || !isActive) {
    return false;
  }
  const maxCount = fieldOptions.maxCount || 0;
  if (maxCount <= 0) {
    return true;
  }
  const count = cellValue?.count || 0;
  return count < maxCount;
};
