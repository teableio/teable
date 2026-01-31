import type { FieldType } from '@teable/core';
import type { IPlanFieldDeleteVo } from '@teable/openapi';

export interface FieldDeleteConfirmDialogProps {
  open: boolean;
  tableId: string;
  fieldIds: string[];
  onClose?: () => void;
}

export interface AffectedField {
  id: string;
  name: string;
  type: FieldType;
  tableName?: string;
}

export interface DeleteAnalysis {
  fieldNames: string[];
  affectedFields: AffectedField[];
}

export type PlanData = {
  fieldId: string;
  data: IPlanFieldDeleteVo | null;
};
